import type { Tx } from '@loomos/db';
import {audit,code,D,ensure,sum,type Actor} from '../../lib/domain.js';
export async function createShipment(tx:Tx,input:{orderId:string;rollIds:string[];transport:string},actor:Actor) {
  ensure(new Set(input.rollIds).size===input.rollIds.length,'A roll cannot be selected twice.');
  const rolls=await tx.fabricRoll.findMany({where:{id:{in:input.rollIds}},include:{production:{include:{item:true}}}});
  ensure(rolls.length===input.rollIds.length,'One or more rolls could not be found.',404);
  for(const roll of rolls) {ensure(roll.quality==='PASSED','Only quality-approved rolls can be shipped.');ensure(!roll.activeShipmentId,'A selected roll is already reserved or dispatched.');ensure(roll.production.item.orderId===input.orderId,'All rolls must belong to the selected buyer order.');}
  const order=await tx.salesOrder.findUnique({where:{id:input.orderId},include:{items:true,shipments:true}});ensure(order,'Order not found.',404);
  ensure(!['CANCELLED','COMPLETED'].includes(order.status),'Order is not eligible for dispatch.');
  const quantity=sum(rolls.map(r=>r.length));
  ensure(quantity.plus(sum(order.shipments.filter(s=>s.status!=='CANCELLED').map(s=>s.quantity))).lte(sum(order.items.map(i=>i.quantity))),'Shipment exceeds the remaining order quantity.');
  const shipment=await tx.shipment.create({data:{number:code('DSP'),orderId:input.orderId,transport:input.transport,quantity,rolls:{create:rolls.map(r=>({rollId:r.id}))}}});
  await tx.fabricRoll.updateMany({where:{id:{in:input.rollIds}},data:{activeShipmentId:shipment.id}});
  await audit(tx,actor,'shipment.created',shipment.id,`${shipment.number} · ${quantity} m reserved for dispatch`);return shipment;
}
export async function verifyRoll(tx:Tx,id:string,rollCode:string) {
  const shipment=await tx.shipment.findUnique({where:{id},include:{rolls:{include:{roll:true}}}});ensure(shipment,'Shipment not found.',404);ensure(shipment.status==='DRAFT','Only draft shipments can be verified.');
  const row=shipment.rolls.find(r=>r.roll.code===rollCode||r.roll.id===rollCode);ensure(row,'This roll does not belong to the shipment.');
  return tx.shipmentRoll.update({where:{id:row.id},data:{verified:true}});
}
export async function confirmShipment(tx:Tx,id:string,actor:Actor) {
  const shipment=await tx.shipment.findUnique({where:{id},include:{rolls:{include:{roll:{include:{production:{include:{item:true}}}}}},order:{include:{items:true,shipments:true}}}});
  ensure(shipment,'Shipment not found.',404);ensure(shipment.status==='DRAFT','Shipment has already been confirmed or cancelled.');
  for(const row of shipment.rolls) {ensure(row.verified,'Verify every roll label before dispatch.');ensure(row.roll.quality==='PASSED'&&row.roll.activeShipmentId===id,'Roll is no longer available for this shipment.');}
  ensure(sum(shipment.rolls.map(r=>r.roll.length)).eq(shipment.quantity),'Selected roll quantities do not reconcile.');
  const total=sum(shipment.rolls.map(r=>r.roll.length.mul(r.roll.production.item.price)));
  const invoice=await tx.invoice.create({data:{number:code('INV'),shipmentId:id,total}});
  await tx.shipment.update({where:{id},data:{status:'DISPATCHED',confirmedAt:new Date()}});
  await tx.fabricRoll.updateMany({where:{activeShipmentId:id},data:{location:'Dispatched'}});
  const shipped=sum(shipment.order.shipments.filter(s=>s.status==='DISPATCHED').map(s=>s.quantity)).plus(shipment.quantity);
  await tx.salesOrder.update({where:{id:shipment.orderId},data:{status:shipped.eq(sum(shipment.order.items.map(i=>i.quantity)))?'COMPLETED':'PARTIAL'}});
  await audit(tx,actor,'shipment.confirmed',id,`${shipment.number} · ${shipment.quantity} m dispatched and invoiced`);return invoice;
}
export async function cancelShipment(tx:Tx,id:string,reason:string,actor:Actor) {
  const shipment=await tx.shipment.findUnique({where:{id},include:{invoice:{include:{payments:true}}}});ensure(shipment,'Shipment not found.',404);ensure(shipment.status!=='CANCELLED','Shipment already cancelled.');
  ensure(!shipment.invoice?.payments.length,'Reverse payments before cancelling an invoiced shipment.');
  if(shipment.invoice) await tx.invoice.update({where:{id:shipment.invoice.id},data:{status:'VOID'}});
  await tx.shipment.update({where:{id},data:{status:'CANCELLED',cancelledAt:new Date(),cancellationReason:reason}});
  await tx.fabricRoll.updateMany({where:{activeShipmentId:id},data:{activeShipmentId:null,location:'Warehouse A · Finished goods'}});
  const remaining=await tx.shipment.count({where:{orderId:shipment.orderId,status:'DISPATCHED'}});
  await tx.salesOrder.update({where:{id:shipment.orderId},data:{status:remaining?'PARTIAL':'READY'}});
  await audit(tx,actor,'shipment.cancelled',id,reason);return {id};
}
export async function buyerPayment(tx:Tx,id:string,input:{amount:number;reference:string},actor:Actor) {
  const invoice=await tx.invoice.findUnique({where:{id},include:{payments:true}});ensure(invoice,'Invoice not found.',404);ensure(invoice.status!=='VOID','A void invoice cannot receive payments.');
  const paid=sum(invoice.payments.map(p=>p.amount)).plus(input.amount);ensure(paid.lte(invoice.total),'Payment exceeds the outstanding balance.');
  const payment=await tx.buyerPayment.create({data:{invoiceId:id,...input}});
  await tx.invoice.update({where:{id},data:{status:paid.eq(invoice.total)?'PAID':'PARTIAL'}});
  await audit(tx,actor,'finance.payment',id,`${D(input.amount).toFixed(2)} received against ${invoice.number}`);return payment;
}
