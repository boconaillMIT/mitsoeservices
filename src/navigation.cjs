function mainNavigation({manage=false,schoolAdmin=false,schoolAccess=schoolAdmin,visibility={},active=''}={}){
 const aeroastroWorkspace=visibility.aeroastroWorkspace===true&&visibility.aeroastroFinance===true&&visibility.features?.['aeroastro-finance']!==false&&!schoolAccess;
 const links=[['home','/?home=1','Services Home'],['my-authorizations','/my-authorizations','My authorizations']];
 if(aeroastroWorkspace){links.push(['aeroastro','/units/aeroastro/full','AeroAstro'],['aeroastro-accounts','/units/aeroastro/finance/accounts','Accounts & outlook','hq'],['aeroastro-people','/units/aeroastro/finance/people','People & appointments','hq']);if(!active)active=visibility.aeroastroView==='home'?'aeroastro':visibility.aeroastroView==='people'?'aeroastro-people':'aeroastro-accounts';}
 if(!visibility.compactUnits&&(visibility.academic??schoolAccess))links.push(['academic','/academic-units','Academic units']);
 if(!visibility.compactUnits&&(visibility.other??schoolAccess))links.push(['other','/other-units','Other units']);
 if(schoolAccess)links.push(['hq','/soe-hq','SoE HQ'],['budget','/soe-hq/budget','Budget','hq'],['budget-fy28','/soe-hq/budget/fy28','FY28 budget cycle','hq-2'] );
 else if(visibility.budget)links.push(['budget','/soe-hq/budget','My department budgets'],['budget-fy28','/soe-hq/budget/fy28','FY28 budget cycle','hq']);
 if(visibility.rct??schoolAdmin)links.push(['rct-review','/soe-hq/rct-review','RCT review',schoolAccess?'hq':false]);
 if(!aeroastroWorkspace)links.push(['donation-requests','/donation-requests','Donation Requests',schoolAccess?'hq':false]);
 if(schoolAdmin&&visibility.features?.nimbus!==false)links.push(['nimbus','/nimbus','Nimbus Search (under construction)']);
 if(schoolAccess){links.push(['settings','/settings','Settings']);if(manage)links.push(['settings-admin','/settings/manage-access','Manage access',true]);links.push(['automatic-reports','/settings/automatic-reports','Automatic reports',true]);}
 if(schoolAdmin)links.push(['visibility','/settings/visibility','Resource visibility',true],['security-review','/settings/security-review','Security review',true]);
 else if(manage&&!schoolAccess)links.push(['admin','/admin','Manage access']);
 const link=([key,href,label,child])=>`<a class="nav${child===true||child==='hq'?' nav-sub':child==='hq-2'?' nav-sub nav-sub2':''}${active===key?' active':''}" href="${href}"${active===key?' aria-current="page"':''}>${label}</a>`;
 const children=links.filter(item=>item[3]===true);
 return `<aside><a class="brand" href="/">SoE<span>MITSOEServices</span></a>${links.filter(item=>item[3]!==true).map(item=>item[0]==='settings'?`<details class="nav-group"><summary class="nav">Settings</summary>${children.map(link).join('')}</details>`:link(item)).join('')}${visibility.testView?require('./test-view.cjs').banner():''}</aside>`;
}
module.exports={mainNavigation};
