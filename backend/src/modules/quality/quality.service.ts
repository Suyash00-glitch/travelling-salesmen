import type { Tx } from '@loomos/db';
import { audit,D,ensure,type Actor } from '../../lib/domain.js';
export async function inspectRoll(tx:Tx,id:string,input:{result:string;defects:string[];notes:string},actor:Actor) {
  const roll=await tx.fabricRoll.findUnique({where:{id},include:{production:{include:{item:true}}}});
  ensure(roll,'Roll not found.',404);ensure(!roll.activeShipmentId,'A reserved or shipped roll cannot be inspected.');
  ensure(roll.quality==='PENDING','Start rework before recording a new inspection.');
  const inspection=await tx.qualityInspection.create({data:{rollId:id,inspector:actor.name,...input}});
  await tx.fabricRoll.update({where:{id},data:{quality:input.result,location:input.result==='PASSED'?'Warehouse A · Finished goods':input.result==='REWORK'?'Rework · Bay 02':'QC · Hold'}});
  if(input.result==='REWORK') await tx.reworkJob.create({data:{rollId:id,reason:input.defects.join(', ')}});
  const pending=await tx.fabricRoll.count({where:{production:{item:{orderId:roll.production.item.orderId}},quality:{not:'PASSED'}}});
  const incomplete=await tx.productionOrder.count({where:{item:{orderId:roll.production.item.orderId},status:{not:'COMPLETED'}}});
  if(!pending&&!incomplete) await tx.salesOrder.update({where:{id:roll.production.item.orderId},data:{status:'READY'}});
  await audit(tx,actor,'quality.inspected',id,`${roll.code} · ${input.result.toLowerCase()}`);return inspection;
}
export async function reworkRoll(tx:Tx,id:string,cost:number,notes:string,actor:Actor) {
  const roll=await tx.fabricRoll.findUnique({where:{id},include:{production:{include:{item:true}},reworks:true}});
  ensure(roll,'Roll not found.',404);ensure(roll.quality==='REWORK'&&!roll.activeShipmentId,'Only unshipped rework rolls can be returned to inspection.');
  const job=roll.reworks.find(j=>j.status==='OPEN');ensure(job,'No open rework job.');
  await tx.reworkJob.update({where:{id:job.id},data:{status:'COMPLETED',cost,completedAt:new Date()}});
  await tx.costAllocation.create({data:{orderId:roll.production.item.orderId,category:'REWORK',amount:D(cost),source:job.id,methodology:notes}});
  await tx.fabricRoll.update({where:{id},data:{quality:'PENDING',cost:{increment:cost}}});
  await audit(tx,actor,'quality.rework',id,`${roll.code} · Rework completed, awaiting reinspection`);return {id};
}
