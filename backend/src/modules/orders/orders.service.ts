import { db, type Tx } from '@loomos/db';
import type { Actor } from '../../lib/domain.js';
import { audit, code, D, ensure, sum } from '../../lib/domain.js';
import type { OrderInput } from '@loomos/shared';
export async function createOrder(tx:Tx,input:OrderInput,actor:Actor) {
  ensure(await tx.buyer.findUnique({where:{id:input.buyerId}}),'Buyer not found.',404);
  for(const item of input.items) ensure(await tx.recipe.findUnique({where:{id:item.recipeId}}),'Recipe not found.',404);
  const order=await tx.salesOrder.create({data:{number:code('SO'),buyerId:input.buyerId,deadline:new Date(input.deadline),priority:input.priority,instructions:input.instructions,items:{create:input.items}},include:{items:true}});
  await audit(tx,actor,'order.created',order.id,`${order.number} · New buyer order confirmed`);
  return order;
}
export async function planOrder(tx:Tx,id:string,actor:Actor) {
  const order=await tx.salesOrder.findUnique({where:{id},include:{items:{include:{recipe:true,production:true}}}});
  ensure(order,'Order not found.',404);ensure(order.status==='CONFIRMED','Only confirmed orders can be planned.');
  for(const item of order.items) {
    ensure(!item.production,'This order is already planned.');
    await tx.productionOrder.create({data:{number:code('WO'),itemId:item.id,target:item.quantity,jobs:{create:item.recipe.route.map((stage,sequence)=>({stage,sequence,target:item.quantity,status:sequence===0?'READY':'PLANNED'}))}}});
  }
  await tx.salesOrder.update({where:{id},data:{status:'PLANNED'}});
  await audit(tx,actor,'order.planned',id,`${order.number} · Production route created`);
  return {id};
}
export async function materialPlan(id:string) {
  const order=await db.salesOrder.findUnique({where:{id},include:{items:{include:{recipe:true,production:{include:{reservations:{include:{lot:true}}}}}}}});
  ensure(order,'Order not found.',404);
  // Pool availability per material/spec so multiple line items do not double-count the same yarn.
  const pools = new Map<string,ReturnType<typeof D>>();
  const lines=[];
  for(const item of order.items) {
    const recipe=item.recipe;
    const lots=await db.yarnLot.findMany({where:{material:recipe.material,specification:recipe.specification}});
    const key=`${recipe.material}:${recipe.specification}`;
    if(!pools.has(key)) pools.set(key,sum(lots.map(l=>l.onHand.minus(l.reserved))));
    const required=item.quantity.mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3);
    const reserved=sum(item.production?.reservations.filter(r=>!r.released).map(r=>r.quantity.minus(r.consumed))??[]);
    const consumed=sum(item.production?.reservations.map(r=>r.consumed)??[]);
    const remaining=PrismaMax(required.minus(reserved).minus(consumed),D(0));
    const available=pools.get(key)!;const shortage=PrismaMax(remaining.minus(available),D(0));
    pools.set(key,PrismaMax(available.minus(remaining),D(0)));
    lines.push({itemId:item.id,fabric:item.fabric,productionId:item.production?.id,material:recipe.material,specification:recipe.specification,required,reserved,consumed,available,shortage,lots:lots.map(l=>({...l,available:l.onHand.minus(l.reserved)}))});
  }
  return lines;
}
const PrismaMax=(a:ReturnType<typeof D>,b:ReturnType<typeof D>)=>a.greaterThan(b)?a:b;
