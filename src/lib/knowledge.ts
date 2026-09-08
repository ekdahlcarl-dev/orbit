import { z } from "zod";
import type { Pool } from "pg";

export const componentSchema = z.object({ repositoryId:z.coerce.number().int().positive(), key:z.string().min(1).max(128), name:z.string().min(1).max(256), kind:z.enum(["component","module","service","capability"]).default("component"), parentId:z.coerce.number().int().positive().optional(), criticality:z.coerce.number().int().min(1).max(5).default(3), metadata:z.record(z.string(),z.unknown()).default({}) }).strict();

export async function upsertComponent(db: Pool, raw: unknown) {
  const x=componentSchema.parse(raw);
  if (x.parentId) {
    const p=(await db.query(`SELECT repository_id FROM knowledge_components WHERE id=$1`,[x.parentId])).rows[0];
    if (!p || Number(p.repository_id)!==x.repositoryId) throw new Error("Parent component must belong to the same repository");
  }
  return (await db.query(`INSERT INTO knowledge_components(repository_id,key,name,kind,parent_id,criticality,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(repository_id,key) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,parent_id=EXCLUDED.parent_id,criticality=EXCLUDED.criticality,metadata=EXCLUDED.metadata,updated_at=now() RETURNING *`,
    [x.repositoryId,x.key,x.name,x.kind,x.parentId??null,x.criticality,x.metadata])).rows[0];
}

export async function addDependency(db: Pool, fromId:number, toId:number, relationship="depends_on") {
  const nodes=(await db.query(`SELECT id,repository_id FROM knowledge_components WHERE id=ANY($1::bigint[])`,[[fromId,toId]])).rows;
  if(nodes.length!==2 || Number(nodes[0].repository_id)!==Number(nodes[1].repository_id)) throw new Error("Dependencies require two components in the same repository");
  return (await db.query(`INSERT INTO knowledge_dependencies(from_component_id,to_component_id,relationship) VALUES($1,$2,$3)
    ON CONFLICT(from_component_id,to_component_id,relationship) DO UPDATE SET metadata=knowledge_dependencies.metadata RETURNING *`,[fromId,toId,relationship])).rows[0];
}

export async function mapCommit(db: Pool, input:{repositoryId:number;commitSha:string;componentId:number;filesChanged?:number;linesAdded?:number;linesDeleted?:number;observedAt?:Date}) {
  return (await db.query(`INSERT INTO knowledge_commit_components(repository_id,commit_sha,component_id,files_changed,lines_added,lines_deleted,observed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(repository_id,commit_sha,component_id) DO UPDATE SET files_changed=EXCLUDED.files_changed,lines_added=EXCLUDED.lines_added,lines_deleted=EXCLUDED.lines_deleted,observed_at=EXCLUDED.observed_at RETURNING *`,
    [input.repositoryId,input.commitSha,input.componentId,input.filesChanged??0,input.linesAdded??0,input.linesDeleted??0,input.observedAt??new Date()])).rows[0];
}

export async function mapTest(db: Pool, input:{componentId:number;testKey:string;level:1|2|3;capabilityKey?:string}) {
  return (await db.query(`INSERT INTO knowledge_test_components(component_id,test_key,level,capability_key) VALUES($1,$2,$3,$4)
    ON CONFLICT(component_id,test_key,level) DO UPDATE SET capability_key=EXCLUDED.capability_key RETURNING *`,[input.componentId,input.testKey,input.level,input.capabilityKey??null])).rows[0];
}
