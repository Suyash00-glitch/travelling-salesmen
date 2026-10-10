import type { Tx } from '@loomos/db';
import type { ReceiptInput } from '@loomos/shared';
import {audit,code,D,ensure,sum,type Actor} from '../../lib/domain.js';
export async function receiveYarn(tx:Tx,input:ReceiptInput,actor:Actor) {
  ensure(await tx.supplier.findUnique({where:{id:input.supplierId}}),'Supplier not found.',404);
  if(input.purchaseId) {
    const po=await tx.purchaseOrder.findUnique({where:{id:input.purchaseId},include:{receipts:true}});
    ensure(po,'Purchase order not found.',404);
    ensure(po.supplierId===input.supplierId&&po.material===input.material&&po.color===input.color&&po.specification===input.specification,'Receipt must match the purchase order.');
    const total=sum(po.receipts.map(r=>r.quantity)).plus(input.quantity);
    ensure(total.lte(po.quantity),'Receipt exceeds the purchase quantity.');
    await tx.purchaseOrder.update({where:{id:po.id},data:{status:total.eq(po.quantity)?'RECEIVED':'PARTIAL'}});
  }
  const lot=await tx.yarnLot.create({data:{code:code('YL'),supplierId:input.supplierId,material:input.material,color:input.color,specification:input.specification,location:input.location,onHand:input.quantity,costPerKg:input.costPerKg,threshold:input.threshold}});
  const receipt=await tx.goodsReceipt.create({data:{reference:input.reference,purchaseId:input.purchaseId,lotId:lot.id,quantity:input.quantity,bill:{create:{total:D(input.quantity).mul(input.costPerKg),dueAt:new Date(Date.now()+30*86400000)}}}});
  await tx.stockMovement.create({data:{lotId:lot.id,kind:'RECEIPT',quantity:input.quantity,reason:'Supplier goods receipt',source:receipt.id}});
  await audit(tx,actor,'inventory.received',lot.id,`${lot.code} · ${input.quantity} kg ${input.material} received`);
  return lot;
}
export async function reserveYarn(tx:Tx,input:{lotId:string;productionId:string;quantity:number},actor:Actor) {
  const lot=await tx.yarnLot.findUnique({where:{id:input.lotId}});
  const production=await tx.productionOrder.findUnique({where:{id:input.productionId},include:{item:{include:{recipe:true}},reservations:true}});
  ensure(lot&&production,'Lot or production order not found.',404);
  ensure(!['COMPLETED','CANCELLED'].includes(production.status),'Production order is closed.');
  ensure(lot.material===production.item.recipe.material&&lot.specification===production.item.recipe.specification,'Yarn does not match this fabric recipe.');
  ensure(lot.onHand.minus(lot.reserved).gte(input.quantity),'Insufficient available yarn.');
  const required=production.target.mul(production.item.recipe.kgPerMetre).mul(D(1).plus(production.item.recipe.wastePercent.div(100))).toDecimalPlaces(3);
  ensure(sum(production.reservations.filter(r=>!r.released).map(r=>r.quantity)).plus(input.quantity).lte(required),'Reservation exceeds the recipe requirement.');
  const reservation=await tx.stockReservation.upsert({where:{lotId_productionId:{lotId:lot.id,productionId:production.id}},create:{lotId:lot.id,productionId:production.id,quantity:input.quantity},update:{quantity:{increment:input.quantity},released:false}});
  await tx.yarnLot.update({where:{id:lot.id},data:{reserved:{increment:input.quantity}}});
  await audit(tx,actor,'inventory.reserved',lot.id,`${input.quantity} kg reserved for ${production.number}`);
  return reservation;
}
export async function adjustStock(tx:Tx,id:string,quantity:number,reason:string,actor:Actor) {
  const lot=await tx.yarnLot.findUnique({where:{id}});ensure(lot,'Lot not found.',404);
  ensure(lot.onHand.plus(quantity).gte(lot.reserved),'Adjustment would reduce stock below reserved quantity.');
  const result=await tx.yarnLot.update({where:{id},data:{onHand:{increment:quantity}}});
  await tx.stockMovement.create({data:{lotId:id,kind:quantity>0?'RETURN':'ADJUSTMENT',quantity,reason,source:code('ADJ')}});
  await audit(tx,actor,'inventory.adjusted',id,reason);return result;
}
