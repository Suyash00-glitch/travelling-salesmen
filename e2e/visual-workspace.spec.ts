import {test, expect, type Page} from '@playwright/test';

const buyer={id:'b1',name:'Arvind Textiles',initials:'AT',city:'Coimbatore'};
const order={id:'o1',number:'ORD-204',buyer,status:'IN_PRODUCTION',priority:'NORMAL',deadline:'2026-10-20',createdAt:'2026-10-10',instructions:'',quantity:'1800',value:'180000',produced:'1200',approved:'1000',dispatched:'400',progress:67,stage:'WEAVING',risk:{level:'NORMAL',reasons:[]},items:[{id:'i1',fabric:'Cotton poplin',color:'Natural',quantity:'1800',price:'100',recipeId:'recipe1',recipe:{name:'Cotton poplin',specification:'40s'},production:null}]};
const machines=Array.from({length:6},(_,i)=>({id:`m${i}`,code:`LM-0${i+1}`,name:['Rapier loom','Air jet loom'][i%2],type:'WEAVING',location:'Weaving floor',status:i<4?'RUNNING':i===4?'IDLE':'BREAKDOWN',capacityPerHour:'100',reportedAt:'2026-10-10T08:00:00Z',todayOutput:String(500-i*50),jobs:[],downtime:[]}));
const rolls=Array.from({length:6},(_,i)=>({id:`r${i}`,code:`ROLL-20${i}`,length:'200',quality:i<4?'PASSED':i===4?'PENDING':'REWORK',location:'Warehouse A',activeShipmentId:null,createdAt:'2026-10-10',production:{id:'p1',number:'WO-204',item:{fabric:'Cotton poplin',color:'Natural',order}}}));
const shipment={id:'s1',number:'SHP-204',status:'DRAFT',transport:'TN 38 AB 2040 · Everest Logistics',quantity:'1200',createdAt:'2026-10-10T08:00:00Z',confirmedAt:null,order,invoice:null,rolls:rolls.map((r,i)=>({id:`sr${i}`,verified:i<4,roll:{...r,quality:'PASSED'}}))};
const secondShipment={...shipment,id:'s2',number:'SHP-205',transport:'TN 37 CD 9051 · Southern Cargo',status:'DISPATCHED',rolls:shipment.rolls.map(r=>({...r,verified:true}))};
const dashboard={activeOrders:12,dueSoon:3,todayOutput:'4200',previousOutput:'3800',running:4,idle:1,breakdown:1,totalMachines:6,pendingQuality:6,finishedRolls:24,passed:24,rejected:2,delayed:2,series:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label,i)=>({label,output:2200+i*300,target:5000})),alerts:[{id:'a1',title:'One machine needs attention',description:'LM-06 has a reported breakdown.',severity:'danger',href:'/machines'}],orders:[order],machines,activity:[{id:'a1',action:'production.output',detail:'Recorded 200 metres for WO-204',actorName:'Sanjay Kumar',createdAt:'2026-10-10T08:00:00Z'}]};
const lots=Array.from({length:3},(_,i)=>({id:`l${i}`,code:`YRN-00${i+1}`,material:'Cotton yarn',color:'Natural',specification:'40s combed',location:'Warehouse A',onHand:String(800-i*200),available:String(600-i*200),reserved:'200',costPerKg:'240',threshold:'250',supplier:{id:'sup1',name:'Southern Yarn Mills'},createdAt:'2026-10-10'}));
const jobs=Array.from({length:4},(_,i)=>({id:`j${i}`,stage:['SPINNING','WEAVING','DYEING','WEAVING'][i],sequence:i,status:['PLANNED','READY','IN_PROGRESS','COMPLETED'][i],target:'1000',output:String(i*200),machine:machines[i],worker:{name:'Sanjay Kumar'},production:{number:`WO-20${i}`,item:{fabric:'Cotton poplin',color:'Natural',recipeId:'recipe1',order},reservations:[],jobs:[{sequence:0},{sequence:1},{sequence:2}]}}));
const user={id:'u1',name:'Aditya Mehta',role:'SUPER_ADMIN',email:'owner@loomos.demo',roles:['SUPER_ADMIN'],active:true,createdAt:'2026-10-10'};
const lookups={buyers:[buyer],suppliers:[{id:'sup1',name:'Southern Yarn Mills',city:'Salem',email:'supplier@example.test'}],recipes:[{id:'recipe1',name:'Cotton poplin',material:'Cotton yarn',specification:'40s combed',kgPerMetre:'0.2',wastePercent:'3',route:['SPINNING','WEAVING','DYEING'],overheadPerMetre:'8'}],workers:[{id:'w1',name:'Sanjay Kumar'}],shifts:[{id:'shift1',name:'Morning shift',startHour:6,hours:8}],machines};
const finance={billed:'180000',received:'120000',cost:'82000',expenses:'12000',outstanding:'60000',estimatedProfit:'86000',cashMovement:'32000',wages:'18000',invoices:[{id:'inv1',number:'INV-204',buyer:buyer.name,order:'ORD-204',total:'180000',paid:'120000',status:'PARTIAL',createdAt:'2026-10-10'}],bills:[],orders:[],costBreakdown:[{category:'MATERIAL',amount:'48000'},{category:'LABOUR',amount:'18000'},{category:'MACHINE',amount:'16000'}]};
const paged=(data:unknown[])=>({data,total:data.length,page:1,pageSize:100});
async function fixture(page:Page,empty=false,role='SUPER_ADMIN'){
 await page.route('**/socket.io/**',route=>route.abort());
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/v1','');
  const endpoints:Record<string,unknown>={
   '/auth/me':{user:{...user,role},csrf:'test-only',demo:true},'/notifications':[], '/lookups':lookups,
   '/dashboard':dashboard,'/orders':paged(empty?[]:[order]),'/shipments':paged(empty?[]:[shipment,secondShipment]),
   '/inventory':paged(empty?[]:lots),'/production':paged(empty?[]:jobs),'/machines':empty?[]:machines,'/rolls':paged(empty?[]:rolls),
   '/purchases':paged(empty?[]:[{id:'po1',number:'PO-104',supplierId:'sup1',supplier:{name:'Southern Yarn Mills'},material:'Cotton yarn',color:'Natural',specification:'40s',quantity:'1200',costPerKg:'240',status:'ORDERED',expectedAt:'2026-10-18',receipts:[{quantity:'400'}]}]),
   '/workers':paged(empty?[]:[{id:'w1',name:'Sanjay Kumar',designation:'Loom operator',initials:'SK',rate:'120',wageType:'HOURLY',attendance:[],assignments:[{job:{machine:{code:'LM-01'},stage:'WEAVING'}}]}]),
   '/reports/finance':finance,'/rbac/users':paged([user]),
   '/rbac/roles':[{id:'r1',name:'Super Admin',code:'SUPER_ADMIN',isSystem:true,userCount:1,permissions:['dashboard:view','orders:view'],description:'Full access to all systems'},{id:'r2',name:'Floor Team Lead',code:'FLOOR_TEAM_LEAD',isSystem:false,userCount:2,permissions:['production:view','production:create'],description:'Shift production supervisor'}],
   '/rbac/factories':[{id:'f1',name:'Everest Weaving Unit I',code:'ETM-01',location:'Surat, Gujarat',active:true,departmentCount:3,userCount:14},{id:'f2',name:'Everest Spinning Mill',code:'ETM-02',location:'Coimbatore, Tamil Nadu',active:true,departmentCount:2,userCount:8}],
   '/rbac/departments':[{id:'d1',name:'Weaving Shed A',code:'WEAV-01',factoryId:'f1',factoryName:'Everest Weaving Unit I',userCount:10,active:true},{id:'d2',name:'Quality Lab',code:'QUAL-01',factoryId:'f1',factoryName:'Everest Weaving Unit I',userCount:4,active:true}],
   '/audit':paged([{id:'a1',actorId:'u1',actorName:'Aditya Mehta',action:'rbac.user.create',entityId:'usr_102',detail:'Assigned operator role to SK',createdAt:'2026-10-10T09:30:00Z'},{id:'a2',actorId:'u1',actorName:'Aditya Mehta',action:'production.job.start',entityId:'job_204',detail:'Started job for WO-204',createdAt:'2026-10-10T08:15:00Z'}]),
  };
  await route.fulfill({json:endpoints[path]??{entries:[],downtime:[]}});
 });
}

test('truck, camera, dispatcher and cargo expose hover, keyboard and click details',async({page})=>{
 await fixture(page);
 await page.goto('/dispatch');
 await expect(page.getByRole('heading',{name:'Cargo loading plan'})).toBeVisible();
 for(const [name,preview,detail] of [
  ['Open truck details','Everest Logistics','Transport reference'],
  ['Open truck camera','No camera feed connected','No camera connected'],
  ['Open dispatcher details','No dispatcher assignment','No dispatcher assigned'],
  ['Open cargo ROLL-200','Label verified','Dispatch check'],
 ]){
  const control=page.getByRole('button',{name,exact:true});
  await control.hover();
  await expect(page.getByRole('tooltip')).toContainText(preview);
  await control.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(detail);
  await page.keyboard.press('Escape');
 }
 await expect(page.getByRole('button',{name:'Confirm dispatch'})).toBeDisabled();
 await page.getByRole('button',{name:/Select truck TN 37/}).click();
 await expect(page.getByRole('dialog')).toContainText('SHP-205');
 await page.keyboard.press('Escape');
 await expect(page.locator('.cargo-panel')).toContainText('All labels verified');
 await page.getByRole('button',{name:/Select truck TN 38/}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Manifest',exact:true}).first().click();
 await expect(page.getByRole('dialog')).toContainText('ROLL-205');
 await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'Search shipment, buyer or truck…'}).fill('nothing-matches');
 await expect(page.getByText('No matching shipments')).toBeVisible();
 await page.getByRole('textbox',{name:'Search shipment, buyer or truck…'}).fill('');
 await page.mouse.move(0,0);
 await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo(0,0);});
 await page.screenshot({path:'test-results/dispatch-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('button',{name:'Open truck camera',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));window.scrollTo(0,0);});
 await page.screenshot({path:'test-results/dispatch-mobile.png',fullPage:true});
});

const pages=[['/','Good'],['/orders','Orders'],['/inventory','Yarn inventory'],['/procurement','Purchasing & suppliers'],['/production','Production board'],['/machines','Machine floor'],['/quality','Quality inspection'],['/rolls','Finished fabric rolls'],['/workforce','Workers & shifts'],['/finance','Finance overview'],['/reports','Factory reports'],['/settings','Workspace settings']];
for(const [path,title] of pages){test(`readable responsive screen: ${path}`,async({page})=>{
 await fixture(page);
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(path);
 await expect(page.locator('.page-heading h1')).toContainText(title);
 await expect(page.locator('.loading-page')).toHaveCount(0);
 if(path!=='/settings')await expect(page.locator('.insight-body').first()).toBeVisible();
 const headingColor=await page.locator('.page-heading h1').evaluate(el=>getComputedStyle(el).color);
 expect(headingColor).toBe('rgb(20, 45, 37)');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:`test-results/redesign-${path.replace('/','')||'dashboard'}.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await expect(page.getByRole('button',{name:'Open navigation'})).toBeVisible();
 await page.getByRole('button',{name:'Open navigation'}).click();
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 await page.getByRole('button',{name:'Close menu'}).click({position:{x:380,y:10}});
 expect(errors).toEqual([]);
});}

test('empty dispatch and inventory explain their next action',async({page})=>{
 await fixture(page,true);
 await page.goto('/dispatch');
 await expect(page.getByText('No shipments yet')).toBeVisible();
 await expect(page.getByRole('button',{name:'Create dispatch'})).toBeVisible();
 await page.goto('/inventory');
 await expect(page.getByText('No records to display yet.')).toBeVisible();
});

 test('buyer delivery view keeps operational actions private',async({page})=>{
  await fixture(page,false,'BUYER');
  await page.goto('/buyer');
  await expect(page.getByRole('heading',{name:'Your order status'})).toBeVisible();
  await page.getByRole('button',{name:'Your shipments'}).click();
  await expect(page.getByRole('heading',{name:'Your deliveries'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create dispatch'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Confirm dispatch'})).toHaveCount(0);
 });

test('settings tabs showcase roles, facilities, and audit trail',async({page})=>{
 await fixture(page);
 await page.goto('/settings');
 await expect(page.locator('.settings-summary')).toBeVisible();

 await page.getByRole('button',{name:'Roles & permissions'}).click();
 await expect(page.getByRole('heading',{name:'Role & Permission Templates'})).toBeVisible();
 await page.screenshot({path:'test-results/redesign-settings-roles.png',fullPage:true});

 await page.getByRole('button',{name:'Facilities & depts'}).click();
 await expect(page.getByRole('heading',{name:'Manufacturing Facilities'})).toBeVisible();
 await expect(page.locator('.facility-card')).toHaveCount(2);
 await page.screenshot({path:'test-results/redesign-settings-facilities.png',fullPage:true});

 await page.getByRole('button',{name:'Audit trail'}).click();
 await expect(page.getByRole('heading',{name:'Immutable Audit Trail'})).toBeVisible();
 await expect(page.locator('table.data-table tbody tr')).toHaveCount(2);
 await page.screenshot({path:'test-results/redesign-settings-audit.png',fullPage:true});
});

