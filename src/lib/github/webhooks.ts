import type { EnvironmentInput } from "../config";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { idSchema, IntegrationError, readLimitedBody, requireInstallation, verifySignature } from "./security";
import { transaction } from "./store";
import { queuePushBuild, syncWorkflowRun } from "../builds";
import { GitHubClient } from "./client";
import { registerArtifact } from "../evidence";

const payloadSchema=z.object({action:z.string().max(100).optional(),installation:z.object({id:idSchema}),repository:z.object({id:idSchema}).optional(),repositories_removed:z.array(z.object({id:idSchema})).optional(),workflow_run:z.object({id:idSchema,workflow_id:idSchema,head_sha:z.string(),status:z.string(),conclusion:z.string().nullable(),run_attempt:z.number().optional()}).optional(),ref:z.string().max(1024).optional(),after:z.string().max(64).optional()});

export async function receiveWebhook(db:Pool,request:Request,env:EnvironmentInput=process.env){const body=await readLimitedBody(request,1024*1024);verifySignature(body,request.headers.get("x-hub-signature-256"),env);const deliveryId=request.headers.get("x-github-delivery");if(!deliveryId||!/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId))throw new IntegrationError(400,"Invalid delivery ID");const event=request.headers.get("x-github-event")??"";if(!["ping","installation","installation_repositories","push","workflow_run"].includes(event))return{ignored:true};if(event==="ping")return{ping:true};const data=payloadSchema.parse(JSON.parse(body.toString("utf8")));requireInstallation(data.installation.id,env);if(["push","workflow_run"].includes(event)&&!data.repository)throw new IntegrationError(400,"Repository identity required");return transaction(db,async client=>{if(data.repository){const authorized=await client.query(`SELECT 1 FROM github_repositories WHERE repository_id=$1 AND installation_id=$2 AND access_status='active'`,[data.repository.id,data.installation.id]);if(!authorized.rowCount)throw new IntegrationError(403,"Repository is not onboarded");}const inserted=await client.query(`INSERT INTO github_deliveries(delivery_id,event,installation_id,repository_id,payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING delivery_id`,[deliveryId,event,data.installation.id,data.repository?.id??null,data]);if(!inserted.rowCount)return{duplicate:true};await client.query("INSERT INTO job_queue(job_type,payload) VALUES ('github.webhook',$1)",[{deliveryId}]);return{accepted:true};});}

async function initialConfidence(client:PoolClient,artifactId:number,buildRunId:number,repositoryId:number,commitSha:string){
  const requirements=await client.query("SELECT provider FROM static_analysis_requirements WHERE repository_id=$1 AND enabled=true AND required=true ORDER BY provider",[repositoryId]);
  let level1="not-configured";
  if(requirements.rowCount){const states:string[]=[];for(const row of requirements.rows){const latest=await client.query("SELECT state FROM static_analysis_results WHERE build_run_id=$1 AND provider=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[buildRunId,row.provider]);states.push(latest.rows[0]?.state??"pending");}level1=states.includes("failed")?"failed":states.includes("running")?"running":states.includes("pending")?"pending":"passed";}
  const l2req=await client.query("SELECT 1 FROM confidence_requirements WHERE repository_id=$1 AND level=2 AND enabled=true AND required=true LIMIT 1",[repositoryId]);
  const level2=!l2req.rowCount?"not-configured":level1!=="passed"?"blocked":"pending";
  const l3req=await client.query("SELECT 1 FROM confidence_requirements WHERE repository_id=$1 AND level=3 AND enabled=true AND required=true LIMIT 1",[repositoryId]);
  const level3=!l3req.rowCount?"not-configured":level1!=="passed"||level2!=="passed"?"blocked":"pending";
  const confidenceLevel=level1!=="passed"?0:level2!=="passed"?1:level3!=="passed"?2:3;
  const snapshot={artifactId,buildRunId,repositoryId,commitSha,deterministic:true,levels:{1:{state:level1},2:{state:level2},3:{state:level3}}};
  await client.query(`INSERT INTO confidence_current(artifact_id,build_run_id,repository_id,commit_sha,confidence_level,level_1_state,level_2_state,level_3_state,snapshot,source,calculated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'deterministic-engine',now()) ON CONFLICT(artifact_id) DO UPDATE SET confidence_level=EXCLUDED.confidence_level,level_1_state=EXCLUDED.level_1_state,level_2_state=EXCLUDED.level_2_state,level_3_state=EXCLUDED.level_3_state,snapshot=EXCLUDED.snapshot,calculated_at=now()`,[artifactId,buildRunId,repositoryId,commitSha,confidenceLevel,level1,level2,level3,snapshot]);
  const transition=await client.query("SELECT 1 FROM confidence_transitions WHERE artifact_id=$1 LIMIT 1",[artifactId]);if(!transition.rowCount)await client.query(`INSERT INTO confidence_transitions(artifact_id,build_run_id,from_level,to_level,from_states,to_states,snapshot,source) VALUES($1,$2,NULL,$3,NULL,$4,$5,'deterministic-engine')`,[artifactId,buildRunId,confidenceLevel,{level1,level2,level3},snapshot]);
}

async function ingestWorkflowArtifacts(client:PoolClient,github:GitHubClient,installationId:number,repositoryId:number,runId:number,buildRunId:number){
  const run=await client.query("SELECT commit_sha FROM build_runs WHERE id=$1",[buildRunId]);if(!run.rowCount)throw new Error("BuildRun missing during artifact ingestion");
  const artifacts=await github.workflowArtifacts(installationId,repositoryId,runId);
  for(const source of artifacts){const digest=source.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();if(!digest)throw new Error(`GitHub artifact ${source.name} has no immutable sha256 digest`);const artifact=await registerArtifact(client,{buildRunId,digestAlgorithm:"sha256",digest,name:source.name,mediaType:"application/zip",sizeBytes:source.size_in_bytes,storageRef:source.archive_download_url});await initialConfidence(client,Number(artifact.id),buildRunId,repositoryId,String(run.rows[0].commit_sha));}
  await client.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,after_value) VALUES('github.webhook','artifacts.ingested',$1,$2,$3)`,[installationId,repositoryId,{githubRunId:runId,buildRunId,artifactCount:artifacts.length}]);
}

export async function processWebhook(client:PoolClient,deliveryId:string,github=new GitHubClient()){
  const result=await client.query("SELECT * FROM github_deliveries WHERE delivery_id=$1 FOR UPDATE",[deliveryId]);const delivery=result.rows[0];if(!delivery)throw new Error("Webhook delivery missing");if(delivery.processed_at)return;const data=payloadSchema.parse(delivery.payload);
  const revokeInstallation=delivery.event==="installation"&&["deleted","suspend"].includes(data.action??"");const removed=delivery.event==="installation_repositories"?data.repositories_removed?.map(r=>r.id)??[]:[];
  if(revokeInstallation||removed.length){const repos=await client.query(`SELECT * FROM github_repositories WHERE installation_id=$1 AND ($2::boolean OR repository_id=ANY($3::bigint[])) FOR UPDATE`,[data.installation.id,revokeInstallation,removed]);for(const before of repos.rows){const updated=await client.query(`UPDATE github_repositories SET enabled=false,access_status='revoked',next_scheduled_at=NULL,updated_at=now() WHERE repository_id=$1 RETURNING *`,[before.repository_id]);await client.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,before_value,after_value) VALUES('github.webhook','repository.access_revoked',$1,$2,$3,$4)`,[data.installation.id,before.repository_id,before,updated.rows[0]]);}}
  if(delivery.event==="push"&&data.repository)await queuePushBuild(client,data.installation.id,data.repository.id,deliveryId,data.ref);
  if(delivery.event==="workflow_run"&&data.repository&&data.workflow_run){const synced=await syncWorkflowRun(client,data.installation.id,data.repository.id,data.workflow_run);if(synced?.status==="succeeded")await ingestWorkflowArtifacts(client,github,data.installation.id,data.repository.id,data.workflow_run.id,synced.buildRunId);}
  await client.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,after_value) VALUES('github.webhook',$1,$2,$3,$4)`,[`webhook.${delivery.event}`,data.installation.id,data.repository?.id??null,{deliveryId,action:data.action}]);await client.query("UPDATE github_deliveries SET processed_at=now() WHERE delivery_id=$1",[deliveryId]);
}
