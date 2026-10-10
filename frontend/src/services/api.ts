let csrf='';
export function setCsrf(value:string){csrf=value;}
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function api<T>(path:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch(`/api/v1${path}`,{method:method??(body===undefined?'GET':'POST'),credentials:'include',headers:{'Content-Type':'application/json',...(body===undefined?{}:{'X-CSRF-Token':csrf,'Idempotency-Key':crypto.randomUUID()})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  let result:{error?:{message?:string}}&Record<string,unknown>|null=null;
  try{result=text?JSON.parse(text):null;}catch{result=null;}
  if(!response.ok)throw new ApiError(response.status,result?.error?.message??(text.trim()||'Something went wrong.'));
  return result as unknown as T;
}
