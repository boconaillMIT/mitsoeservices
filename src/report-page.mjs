import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import access from './access.cjs';
import navigation from './navigation.cjs';
export function createReportHandler(authorize = access.authorize) {
  return async event => {
    if (event.httpMethod !== 'GET') return {statusCode:405, headers:access.noStore, body:'GET required'};
    const result = await authorize(event,{scope:'school',minimum:event.queryStringParameters?.refresh==='1'?'admin':'read'});
    const headers = {...access.noStore, 'Content-Type':'text/html; charset=utf-8'};
    const query=new URLSearchParams();if(['deans','all'].includes(event.queryStringParameters?.view))query.set('view',event.queryStringParameters.view);if(event.queryStringParameters?.refresh==='1')query.set('refresh','1');
    if (result.statusCode === 401) return {statusCode:200, headers,body:(await readFile(join(process.cwd(),'src/login.html'),'utf8')).replace('returnTo=%2F','returnTo='+encodeURIComponent('/reports'+(query.size?'?'+query:'')))};
    if (!result.user) return result;
    const refreshing=event.queryStringParameters?.refresh==='1';
    if(!refreshing){const html=(await readFile(join(process.cwd(),'src/published-report.html'),'utf8')).replace('<!--MAIN-NAV-->',navigation.mainNavigation({manage:result.canManage,schoolAdmin:result.admin,schoolAccess:result.schoolAccess,visibility:result.navigation,active:'hq'}));return {statusCode:200,headers,body:html.replace('<h1>Account outlook</h1>',event.queryStringParameters?.view==='deans'?'<h1>Dean’s discretionary accounts</h1>':'<h1>All SoE-controlled accounts</h1>').replace('<!--REFRESH-LINK-->',result.admin?'<a class="desktop" href="/reports?refresh=1&view=all">Refresh and publish</a>':'')};}
    const html=(await readFile(join(process.cwd(),'src/report.html'),'utf8')).replace('<!--MAIN-NAV-->',navigation.mainNavigation({manage:result.canManage,schoolAdmin:result.admin,schoolAccess:result.schoolAccess,visibility:result.navigation,active:'hq'}));
    return {statusCode:200, headers, body:event.queryStringParameters?.view==='all'?html.replace('<h1>Account outlook</h1>','<h1>All SoE-controlled accounts</h1>'):event.queryStringParameters?.view==='deans'?html.replace('<h1>Account outlook</h1>','<h1>Dean’s discretionary accounts</h1>'):html};
  };
}
export const handler = createReportHandler();
