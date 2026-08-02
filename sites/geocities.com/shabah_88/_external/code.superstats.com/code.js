// Copyright (C) 1999-2001 by MyComputer.com.  All rights reserved.
/* You may give each page an identifying name, server, and channel on the next lines. */
var pageName;if(!pageName)pageName=""
var server;if(!server)server=""
var channel;if(!channel)channel=""
var pageType;if(!pageType)pageType=""
var pageValue;if(!pageValue)pageValue=""
var product;if(!product)product=""
var visitorSampling;if(!visitorSampling)visitorSampling=""
var prop1;if(!prop1)prop1='';var prop2;if(!prop2)prop2='';var prop3;if(!prop3)prop3='';var prop4;if(!prop4)prop4=''
var prop5;if(!prop5)prop5='';var prop6;if(!prop6)prop6='';var prop7;if(!prop7)prop7='';var prop8;if(!prop8)prop8=''
var prop9;if(!prop9)prop9='';var prop10;if(!prop10)prop10='';var prop11;if(!prop11)prop11='';var prop12;if(!prop12)prop12=''
var prop13;if(!prop13)prop13='';var prop14;if(!prop14)prop14='';var prop15;if(!prop15)prop15='';var prop16;if(!prop16)prop16=''
var prop17;if(!prop17)prop17='';var prop18;if(!prop18)prop18='';var prop19;if(!prop19)prop19='';var prop20;if(!prop20)prop20=''
function mc_escape(s){var ch;s=escape(s)
while((ch=s.indexOf('+'))>0)s=s.substr(0,ch)+'%2B'+s.substr(ch+1,s.length)
while((ch=s.indexOf('/'))>0)s=s.substr(0,ch)+'%2F'+s.substr(ch+1,s.length)
return s}
var mc_t=new Date;var mc_n1=Math.floor(mc_t.getTime()/10800000)%10
var mc_n2=mc_t.getTime()%10000000000000;var mc_s=mc_n1+'fsi'+mc_n2
var code=''
function mc_mkcd(){var s='',c='',v='',p='',bw='',bh='',sp=''
var j='1.0'
var g=window.location.href
var a=mc_apn+' '+mc_apv
var o=navigator.platform
var h=history.length
var r=(mc_r?mc_r:(mc_noe?'NULL':'External Frame Referrer'))
var yr,t=mc_t.getDate()+'/'+mc_t.getMonth()+'/'+((yr=mc_t.getYear())<1900?yr+1900:yr)+' '+mc_t.getHours()+':'+mc_t.getMinutes()+':' + mc_t.getSeconds()+' '+mc_t.getDay()+' '+mc_t.getTimezoneOffset()
document.cookie='ssACK=true';var k=(document.cookie.indexOf('ssACK=')!=-1?'Y':'N')
if(mc_apv>=4)s=screen.width+'x'+screen.height
if(mc_apn=='Netscape'){var i1=0,i2=0,sta;while((i1<navigator.plugins.length)&&(i2<30)){sta=navigator.plugins[i1].name
if(sta.length>100)sta=sta.substring(0,100);sta+=';'
if(p.indexOf(sta)==-1)p+=sta;i1++;i2++}
v=(navigator.javaEnabled()?'Y':'N')
if(mc_apv>=3)j='1.1'
if(mc_apv>=4){j='1.2'
c=screen.pixelDepth
bw=window.innerWidth
bh=window.innerHeight
sp=navigator.securityPolicy
}if(mc_apv>=4.06)j='1.3'
}code='<im'+'g src="http://stats.superstats.com/b/ss//1/31/'+mc_s+'?[AQB]r='+mc_escape(r)+'&s='+mc_escape(s)+'&c='+mc_escape(c)+'&o='+mc_escape(o)+'&j='+j+'&v='+v+'&k='+k+'&h='+h+'&sp='+mc_escape(sp)+'&bw='+bw+'&bh='+bh+'&t='+mc_escape(t)+'&pageName='+mc_escape(pageName)+'&server='+mc_escape(server)+'&ch='+mc_escape(channel)+'&pageType='+mc_escape(pageType)+'&pageValue='+mc_escape(pageValue)+'&product='+mc_escape(product)+'&c1='+mc_escape(prop1)+'&c2='+mc_escape(prop2)+'&c3='+mc_escape(prop3)+'&c4='+mc_escape(prop4)+'&c5='+mc_escape(prop5)+'&c6='+mc_escape(prop6)+'&c7='+mc_escape(prop7)+'&c8='+mc_escape(prop8)+'&c9='+mc_escape(prop9)+'&c10='+mc_escape(prop10)+'&c11='+mc_escape(prop11)+'&c12='+mc_escape(prop12)+'&c13='+mc_escape(prop13)+'&c14='+mc_escape(prop14)+'&c15='+mc_escape(prop15)+'&c16='+mc_escape(prop16)+'&c17='+mc_escape(prop17)+'&c18='+mc_escape(prop18)+'&c19='+mc_escape(prop19)+'&c20='+mc_escape(prop20)+'&box=www67.mycomputer.com'+'&g='+mc_escape(g)+'&a='+mc_escape(a)+'&p='+mc_escape(p)+'[AQE]'+'" height=1 width=1 border=0>'
if(!mc_noe)document.write(code)

return code}var mc_n=navigator,mc_apn=mc_n.appName,mc_w=mc_n.appVersion,mc_apv,mc_i
var mc_msie=mc_w.indexOf('MSIE ')
if(mc_w.indexOf('Opera')>0)mc_apn='Opera'
if(mc_msie>0){mc_apv=parseInt(mc_i=mc_w.substring(mc_msie+5))
if(mc_apv>3)mc_apv=parseFloat(mc_i)}else mc_apv=parseFloat(mc_w)
function mc_et(){window.onerror=window.oe;return true}var mc_noe=false;var mcr_done=false
/*@cc_on@if(@_jscript_version>=5){var mc_r='';try{mc_r=parent.document.referrer;mc_noe=true}catch(e){}mcr_done=true}@end@*/
if(!mcr_done){if(navigator.userAgent.indexOf('Mac')>=0&&navigator.userAgent.indexOf('MSIE 4')>=0){var mc_r=document.referrer;mc_noe=true}
else{window.oe=window.onerror;window.onerror=mc_et;var mc_r=parent.document.referrer;mc_noe=mc_et()}}
var visitorSampling
if (!visitorSampling)visitorSampling=0
var mc_vS=visitorSampling,mc_vSp=1
if(mc_vS){var mc_vSt=mc_t.getTime(),mc_vSc=' '+document.cookie+';'
if((mc_vSpo=mc_vSc.indexOf(' ssvSp='))>=0){mc_vSp=parseInt(mc_vSc.substring(mc_vSpo+7))}
else{if(mc_vS>1){if(mc_vSt%100000>=mc_vS*1000)mc_vSp=0}else{if(mc_vSt%(100/mc_vS)!=1)mc_vSp=0}document.cookie='ssvSp='+mc_vSp}}
if(mc_vSp){code=mc_mkcd();
}
