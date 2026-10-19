// Copyright RealTracker, 9-JAN-2001, info@realtracker.com
function cv(s){cc=document.cookie;r='';i=cc.indexOf(s);if(i>-1){
os=cc.indexOf('=',i)+1;oe=cc.indexOf(';',i)
if(oe<0)oe=cc.length;r=cc.substring(os,oe)};return r}
function wc(n,v,t){document.cookie=n+'='+v+'; path=/; expires='+t.toGMTString()+';'}
function fdy(n){s=''+n;if(n<100)s='19'+s;return s}
function td(n){s=''+n;if(s.length==1)s='0'+s;return s}
function f(s2,s){document.write(s2+'<IMG SRC="'+s+'" BORDER=0 WIDTH=32 HEIGHT=32 ALT="RealTracker Free"></A>')

// regels van de minibanner
var ban=new Date();
if(ban.getSeconds()%2==0||ban.getSeconds()%5==2){//0|2
document.write('<A HREF="http://adserver1.realtracker.com/banman.asp?ZoneID=4&Task=Click&Mode=HTML&PageID=5866" target="_blank">');
document.write('<img src="http://adserver1.realtracker.com/banman.asp?ZoneID=4&Task=Get&Mode=HTML&PageID=5866" border=0 width=88 height=31></A>');
} else {
//document.write('<A HREF="http://www6.bannerspace.com/asp/gosite.asp?MID=11616" target="_blank">');
//document.write('<img src="http://www6.bannerspace.com/asp/getban.asp?MID=11616" border=0 width=88 height=31></A>');
  document.write('<font face=impact size=2><center>Coming Soon ...<br>Free Publishing !</center></font>');
}
// einde minibanner

}

if(navigator.userAgent.indexOf('MSIE 3')<0){t=new Date()
res+='&tt='+td(t.getMonth()+1)+'%2F'+td(t.getDate())+'%2F'+fdy(t.getYear())+'+'+td(t.getHours())+'%3A'+td(t.getMinutes())+'%3A'+td(t.getSeconds())
t.setTime (t.getTime()+900000)
rt=cv('RT_id');if(rt=='')rt=parseInt(2000000*Math.random());wc('RT_id',rt,t)
c='RT_page';r1=cv('RT_speed');r=cv(c);if(r=='')r=0;wc(c,r,t)
res+='&b='+rt+'&p='+r+'&spd='+r1+'&ck='+(cv(c)!=''?1:0)
rd=Math.round(Math.random()*1000000);res+='&d='+rd;if(navigator.appVersion.charAt(0)>3){
res+='&h='+screen.height+'&w='+screen.width+'&c='+(screen.pixelDepth?screen.pixelDepth:screen.colorDepth)}
res+='&j='+(navigator.javaEnabled()?1:0)+'&ref='+escape(document.referrer)
}
