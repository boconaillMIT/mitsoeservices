function mainNavigation({manage=false,schoolAdmin=false,schoolAccess=schoolAdmin,visibility={},active=''}={}){
 const links=[['home','/?home=1','Services Home']];
 if(!visibility.compactUnits&&(visibility.academic??schoolAccess))links.push(['academic','/academic-units','Academic units']);
 if(!visibility.compactUnits&&(visibility.other??schoolAccess))links.push(['other','/other-units','Other units']);
 if(schoolAccess)links.push(['hq','/soe-hq','SoE HQ']);
 if(schoolAdmin&&visibility.features?.nimbus!==false)links.push(['nimbus','/nimbus','Nimbus Search (under construction)']);
 if(schoolAccess){links.push(['settings','/settings','Settings']);if(manage)links.push(['settings-admin','/settings/manage-access','Manage access',true]);links.push(['automatic-reports','/settings/automatic-reports','Automatic reports',true]);}
 if(schoolAdmin)links.push(['visibility','/settings/visibility','Resource visibility',true],['security-review','/settings/security-review','Security review',true]);
 else if(manage&&!schoolAccess)links.push(['admin','/admin','Manage access']);
 const link=([key,href,label,child])=>`<a class="nav${child?' nav-sub':''}${active===key?' active':''}" href="${href}"${active===key?' aria-current="page"':''}>${label}</a>`;
 const children=links.filter(item=>item[3]);
 return `<aside><a class="brand" href="/">SoE<span>MITSOEServices</span></a>${links.filter(item=>!item[3]).map(item=>item[0]==='settings'?`<details class="nav-group"><summary class="nav">Settings</summary>${children.map(link).join('')}</details>`:link(item)).join('')}${visibility.testView?require('./test-view.cjs').banner():''}</aside>`;
}
module.exports={mainNavigation};
