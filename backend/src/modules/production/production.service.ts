import type { Tx } from '@loomos/db';
import type { OutputInput } from '@loomos/shared';
import {audit,code,D,ensure,sum,type Actor} from '../../lib/domain.js';
export async function startJob(tx:Tx,id:string,input:{machineId:string;workerId:string;shiftId:string},actor:Actor) {
  const job=await tx.jobCard.findUnique({where:{id},include:{production:{include:{jobs:true,item:{include:{recipe:true}},reservations:true}}}});
  ensure(job,'Job not found.',404);ensure(['READY','PAUSED','BLOCKED'].includes(job.status),'This job is not ready to start.');
  if(job.sequence>0) ensure(job.production.jobs.find(j=>j.sequence===job.sequence-1)?.status==='COMPLETED','Complete the previous production stage first.');
  if(job.sequence===0) ensure(sum(job.production.reservations.filter(r=>!r.released).map(r=>r.quantity)).gte(job.target.mul(job.production.item.recipe.kgPerMetre).mul(D(1).plus(job.production.item.recipe.wastePercent.div(100))).toDecimalPlaces(3)),'Reserve the complete recipe requirement before starting production.');
  const machine=await tx.machine.findUnique({where:{id:input.machineId}});ensure(machine,'Machine not found.',404);
  ensure(machine.type===job.stage,'Machine type does not match this stage.');ensure(machine.status==='IDLE','Machine must be idle.');
  ensure(!await tx.jobCard.findFirst({where:{machineId:machine.id,status:'IN_PROGRESS'}}),'Machine already has an active job.');
  const worker=await tx.worker.findUnique({where:{id:input.workerId}});ensure(worker?.active,'Worker not available.');
  ensure(!await tx.workerAssignment.findFirst({where:{workerId:input.workerId,endedAt:null}}),'Worker already has an active assignment.');
  ensure(await tx.shift.findUnique({where:{id:input.shiftId}}),'Shift not found.',404);
  const updated=await tx.jobCard.update({where:{id},data:{...input,status:'IN_PROGRESS',startedAt:job.startedAt??new Date(),assignments:{create:{workerId:input.workerId}}}});
  await tx.machine.update({where:{id:machine.id},data:{status:'RUNNING',reportedAt:new Date()}});
  await tx.productionOrder.update({where:{id:job.productionId},data:{status:'IN_PROGRESS'}});
  await tx.salesOrder.update({where:{id:job.production.item.orderId},data:{status:'IN_PRODUCTION'}});
  await audit(tx,actor,'production.started',id,`${machine.code} · ${job.stage.toLowerCase()} started`);return updated;
}
export async function recordOutput(tx:Tx,id:string,input:OutputInput,actor:Actor) {
  const job=await tx.jobCard.findUnique({where:{id},include:{machine:true,worker:true,production:{include:{item:{include:{recipe:true}},jobs:true}}}});
  ensure(job,'Job not found.',404);ensure(job.status==='IN_PROGRESS'&&job.machine?.status==='RUNNING','Start a job on an available machine before recording output.');
  if(actor.role==='OPERATOR') ensure(job.workerId===actor.workerId,'This job is assigned to another operator.',403);
  ensure(job.output.plus(input.quantity).lte(job.target),'Output cannot exceed the job target.');
  ensure(D(input.hours).lte(16),'A production entry cannot exceed 16 hours.');
  const recipe=job.production.item.recipe;
  const last=job.sequence===Math.max(...job.production.jobs.map(j=>j.sequence));
  ensure(last?sum(input.rollLengths).eq(input.quantity):input.rollLengths.length===0,last?'Roll lengths must equal the recorded output.':'Rolls can only be produced at the final manufacturing stage.');
  const entry=await tx.productionEntry.create({data:{jobId:id,quantity:input.quantity,waste:input.waste,hours:input.hours}});
  if(job.sequence===0) {
    ensure(input.lotId&&input.consumedKg>0,'Record actual yarn consumption for this stage.');
    const reservation=await tx.stockReservation.findUnique({where:{lotId_productionId:{lotId:input.lotId,productionId:job.productionId}},include:{lot:true}});
    ensure(reservation&&!reservation.released,'Reserve this lot for this production order first.');
    ensure(reservation.quantity.minus(reservation.consumed).gte(input.consumedKg)&&reservation.lot.onHand.gte(input.consumedKg),'Consumption exceeds the remaining reserved yarn.');
    const expected=D(input.quantity).plus(input.waste).mul(recipe.kgPerMetre);
    ensure(D(input.consumedKg).gte(expected.mul('0.8'))&&D(input.consumedKg).lte(expected.mul('1.2')),'Yarn usage must be within 20% of the configured recipe, including reported waste.');
    const cost=D(input.consumedKg).mul(reservation.lot.costPerKg);
    await tx.materialConsumption.create({data:{entryId:entry.id,lotId:input.lotId,quantity:input.consumedKg,cost}});
    await tx.yarnLot.update({where:{id:input.lotId},data:{onHand:{decrement:input.consumedKg},reserved:{decrement:input.consumedKg}}});
    await tx.stockReservation.update({where:{id:reservation.id},data:{consumed:{increment:input.consumedKg}}});
    await tx.stockMovement.create({data:{lotId:input.lotId,kind:'CONSUMPTION',quantity:D(input.consumedKg).negated(),reason:`Production output · ${job.production.number}`,source:entry.id}});
    await tx.costAllocation.create({data:{orderId:job.production.item.orderId,category:'MATERIAL',amount:cost,source:entry.id,methodology:'Actual consumed kilograms × receipt unit cost'}});
  } else ensure(input.consumedKg===0,'Raw yarn is consumed only in the first route stage.');
  const machineCost=job.machine.hourlyCost.mul(input.hours);
  const labour=job.worker?(job.worker.wageType==='HOURLY'?job.worker.rate.mul(input.hours):job.worker.rate.mul(input.quantity)):D(0);
  await tx.costAllocation.createMany({data:[{category:'MACHINE',amount:machineCost,methodology:'Reported run hours × machine hourly rate'},{category:'LABOUR',amount:labour,methodology:'Reported job hours or output × worker rate; payroll tracked separately'},...(last?[{category:'OVERHEAD',amount:D(input.quantity).mul(recipe.overheadPerMetre),methodology:'Final-stage output × configured overhead per metre'}]:[])].map(c=>({...c,orderId:job.production.item.orderId,source:entry.id}))});
  if(last) {
    const costs=await tx.costAllocation.findMany({where:{orderId:job.production.item.orderId}});
    const rate=sum(costs.map(c=>c.amount)).div(sum(job.production.jobs.filter(j=>j.sequence===job.sequence).map(j=>j.output)).plus(input.quantity));
    for(const length of input.rollLengths) await tx.fabricRoll.create({data:{code:code('RL'),productionId:job.productionId,entryId:entry.id,length,cost:rate.mul(length)}});
  }
  await tx.jobCard.update({where:{id},data:{output:{increment:input.quantity}}});
  await tx.machine.update({where:{id:job.machine.id},data:{reportedAt:new Date()}});
  await audit(tx,actor,'production.output',id,`${job.machine.code} · ${input.quantity} m output recorded`);return entry;
}
export async function transitionJob(tx:Tx,id:string,action:'pause'|'complete',actor:Actor) {
  const job=await tx.jobCard.findUnique({where:{id},include:{production:{include:{jobs:true,reservations:true,item:true}}}});
  ensure(job,'Job not found.',404);ensure(job.status==='IN_PROGRESS','Only running jobs can be paused or completed.');
  if(actor.role==='OPERATOR') ensure(job.workerId===actor.workerId,'This job is assigned to another operator.',403);
  if(action==='complete') ensure(job.output.gte(job.target),'Record the full target output before completing this stage.');
  await tx.jobCard.update({where:{id},data:{status:action==='complete'?'COMPLETED':'PAUSED',endedAt:action==='complete'?new Date():null}});
  await tx.workerAssignment.updateMany({where:{jobId:id,endedAt:null},data:{endedAt:new Date()}});
  if(job.machineId) await tx.machine.update({where:{id:job.machineId},data:{status:'IDLE',reportedAt:new Date()}});
  if(action==='complete') {
    const next=job.production.jobs.find(j=>j.sequence===job.sequence+1);
    if(next) await tx.jobCard.update({where:{id:next.id},data:{status:'READY'}});
    else {
      await tx.productionOrder.update({where:{id:job.productionId},data:{status:'COMPLETED'}});
      for(const r of job.production.reservations.filter(r=>!r.released)) {await tx.yarnLot.update({where:{id:r.lotId},data:{reserved:{decrement:r.quantity.minus(r.consumed)}}});await tx.stockReservation.update({where:{id:r.id},data:{released:true}});}
      const pending=await tx.productionOrder.count({where:{item:{orderId:job.production.item.orderId},status:{not:'COMPLETED'}}});
      if(!pending) await tx.salesOrder.update({where:{id:job.production.item.orderId},data:{status:'QUALITY'}});
    }
  }
  await audit(tx,actor,`production.${action}`,id,`${job.stage.toLowerCase()} ${action==='complete'?'completed':'paused'}`);return {id};
}
export async function machineAction(tx:Tx,id:string,action:'breakdown'|'recover',reason:string,actor:Actor) {
  const machine=await tx.machine.findUnique({where:{id}});ensure(machine,'Machine not found.',404);
  if(action==='breakdown') {
    ensure(machine.status!=='BREAKDOWN','This breakdown has already been reported.');
    await tx.downtimeEvent.create({data:{machineId:id,reason}});
    const jobs=await tx.jobCard.findMany({where:{machineId:id,status:'IN_PROGRESS'}});
    for(const job of jobs) {await tx.jobCard.update({where:{id:job.id},data:{status:'BLOCKED'}});await tx.workerAssignment.updateMany({where:{jobId:job.id,endedAt:null},data:{endedAt:new Date()}});}
  } else {ensure(['BREAKDOWN','MAINTENANCE','OFFLINE'].includes(machine.status),'Machine is already available.');await tx.downtimeEvent.updateMany({where:{machineId:id,endedAt:null},data:{endedAt:new Date()}});}
  const result=await tx.machine.update({where:{id},data:{status:action==='breakdown'?'BREAKDOWN':'IDLE',reportedAt:new Date()}});
  await audit(tx,actor,`machine.${action}`,id,`${machine.code} · ${reason}`);return result;
}
