const controls=[['department','Department controlled','#306249'],['faculty','Faculty controlled','#b4c7d7'],['other','Other / unclassified','#d6c8ac']];
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
export function historyPoints(rows,type){
 const selected=rows.filter(r=>r.type===type),years=[...new Set(selected.map(r=>r.year))].sort((a,b)=>a-b);
 const sum=items=>{const known=items.filter(r=>finite(r.amount));return items.length&&!known.length&&type!=='GIB Carryforward'?null:known.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100;};
 return years.map(year=>{
  const items=selected.filter(r=>r.year===year);
  return {year,total:sum(items),department:sum(items.filter(r=>r.admin==='DP')),faculty:sum(items.filter(r=>r.admin==='FC')),other:sum(items.filter(r=>!['DP','FC'].includes(r.admin))),blanks:items.filter(r=>!finite(r.amount)).length,projection:items.some(r=>r.projection===true||r.projection===1||r.projection==='1'),periods:[...new Set(items.map(r=>String(r.period||'')).filter(Boolean))]};
 });
}
const short=v=>v===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);
const exact=v=>v===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
function node(tag,value,cls){const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(cls)el.className=cls;return el;}
function svgNode(tag,attrs={},value){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,val]of Object.entries(attrs))el.setAttribute(key,String(val));if(value!==undefined)el.textContent=value;return el;}
export function renderWalletCharts(container,rows,{controller='Department',types=['GIB Carryforward','Expendable Fund Balance','GIB Base','Pool A Payout']}={}){
 const displayControls=controls.map(([key,label,color])=>[key,key==='department'?controller+' controlled':label,color]);
 container.replaceChildren();
 for(const type of types){
  const points=historyPoints(rows,type),card=node('section',undefined,'card wallet-history');card.append(node('h2',type+' history'));
  if(!points.length){card.append(node('p','No history supplied for this resource.'));container.append(card);continue;}
  const legend=node('div',undefined,'history-legend');for(const [,label,color]of displayControls){const entry=node('span'),swatch=node('i');swatch.style.backgroundColor=color;entry.append(swatch,document.createTextNode(label));legend.append(entry);}card.append(legend);
  const width=Math.max(460,points.length*120),height=360,baseline=205;
  const positive=p=>controls.reduce((n,[key])=>n+Math.max(0,p[key]||0),0),negative=p=>controls.reduce((n,[key])=>n+Math.max(0,-(p[key]||0)),0);
  const maxPositive=Math.max(...points.map(positive),1),maxNegative=Math.max(...points.map(negative),0),scale=130/Math.max(maxPositive,maxNegative||1);
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':type+' history by fiscal year, split by account control'});
  svg.append(svgNode('title',{},type+' history'),svgNode('line',{x1:15,x2:width-15,y1:baseline,y2:baseline,stroke:'#8b9b8d'}));
  points.forEach((p,i)=>{
   const x=(i+.5)*width/points.length,barWidth=Math.min(62,width/points.length*.55);let above=baseline,below=baseline;
   svg.append(svgNode('text',{x,y:22,'text-anchor':'middle',class:'history-dept'},short(p.department)+(controller==='School'?' school':' dept')),svgNode('text',{x,y:42,'text-anchor':'middle',class:'history-total'},short(p.total)+' total'));
   for(const [key,label,color]of displayControls){const value=p[key];if(value===null||value===0)continue;const h=Math.abs(value)*scale,y=value>0?above-h:below;const rect=svgNode('rect',{x:x-barWidth/2,y,width:barWidth,height:h,fill:color,stroke:p.projection?'#4b6456':'none','stroke-dasharray':p.projection?'4 3':'none'});rect.append(svgNode('title',{},`FY${p.year} · ${label}: ${exact(value)}${p.projection?' · projected':''}`));svg.append(rect);if(value>0)above=y;else below+=h;}
   // Keep the year and source notes below all negative segments.
   const labelY=baseline+maxNegative*scale+22;
   for(const [offset,value,cls]of [[0,'FY'+p.year,'history-year'],[19,p.projection?'Projected':p.periods.some(v=>v.endsWith('02'))?'Period 02 / source YTD':p.periods.length?'Year-end':'Carry-in / base','history-note'],[38,short(p.faculty)+' faculty','history-note']])svg.append(svgNode('text',{x,y:labelY+offset,'text-anchor':'middle',class:cls},value));
  });
  // Expand for negative histories without clipping the labels.
  svg.setAttribute('viewBox',`0 0 ${width} ${Math.max(height,baseline+maxNegative*scale+100)}`);
  const scroll=node('div',undefined,'history-scroll');scroll.append(svg);card.append(scroll,node('p','All account controls are shown. Dashed bars indicate projections.','small'));container.append(card);
 }
}
