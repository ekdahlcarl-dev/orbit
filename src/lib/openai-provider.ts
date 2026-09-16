import { z } from "zod";
import type { AssistantAnswer, LlmProvider } from "./ai-assistant";

const recommendation=z.object({componentKey:z.string(),targetLevel:z.union([z.literal(1),z.literal(2),z.literal(3)]),action:z.string(),rationale:z.string(),uncertainty:z.enum(["low","medium","high"]),citations:z.array(z.object({id:z.number().int().positive(),sourceType:z.string(),sourceRef:z.string(),excerpt:z.string()})).min(1)});
const answerSchema=z.object({answer:z.string(),recommendations:z.array(recommendation)});

async function openAi(path:string,body:unknown,apiKey:string){const r=await fetch(`https://api.openai.com/v1/${path}`,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error(`OpenAI request failed (${r.status})`);return r.json()}

export class OpenAiProvider implements LlmProvider {
 readonly name="openai"; constructor(readonly model:string,private apiKey:string){}
 async complete(input:{question:string;context:unknown}):Promise<AssistantAnswer>{
  const data=await openAi("responses",{model:this.model,input:[{role:"system",content:"You are ORBIT's quality assistant. Use only supplied ORBIT context. Separate measured facts, derived analytics and AI interpretation. Return JSON only. Every recommendation must cite evidence ids from measuredEvidence. Never claim to change confidence state."},{role:"user",content:JSON.stringify(input)}],text:{format:{type:"json_schema",name:"orbit_recommendation",strict:true,schema:{type:"object",additionalProperties:false,required:["answer","recommendations"],properties:{answer:{type:"string"},recommendations:{type:"array",items:{type:"object",additionalProperties:false,required:["componentKey","targetLevel","action","rationale","uncertainty","citations"],properties:{componentKey:{type:"string"},targetLevel:{type:"integer",enum:[1,2,3]},action:{type:"string"},rationale:{type:"string"},uncertainty:{type:"string",enum:["low","medium","high"]},citations:{type:"array",minItems:1,items:{type:"object",additionalProperties:false,required:["id","sourceType","sourceRef","excerpt"],properties:{id:{type:"integer"},sourceType:{type:"string"},sourceRef:{type:"string"},excerpt:{type:"string"}}}}}}}}}}},this.apiKey);
  const text=data.output?.flatMap((o:{content?:Array<{type:string;text?:string}>})=>o.content??[]).find((c:{type:string})=>c.type==="output_text")?.text;if(!text)throw new Error("OpenAI returned no structured answer");return answerSchema.parse(JSON.parse(text));
 }
}
export async function embedQuestion(text:string,apiKey:string,model="text-embedding-3-small"){const data=await openAi("embeddings",{model,input:text,dimensions:1536},apiKey);return z.array(z.number()).parse(data.data?.[0]?.embedding)}
export function getOpenAiProvider(){const key=process.env.OPENAI_API_KEY;if(!key)throw new Error("OPENAI_API_KEY is not configured");return {provider:new OpenAiProvider(process.env.ORBIT_OPENAI_MODEL??"gpt-5-mini",key),apiKey:key}}
