function gotag()
{
var expires=new Date();
var listedomaine="*.monde-diplomatique.fr*193.56.58.62*.en.monde-diplomatique.fr*.mondediplo.com*"
var posdebfirstdomaine=0
var posfinfirstdomaine=0
var param="";
var posonedomaine=-1
var param=""
var onedomaine=""
expires.setTime (expires.getTime() + (30 * 60 * 1000)); // 30 mins
while ((posfinfirstdomaine!=-1) && (posonedomaine==-1))
{
posfinfirstdomaine=listedomaine.indexOf("*",posdebfirstdomaine+1)
if (posfinfirstdomaine!=-1)
{
onedomaine=listedomaine.substring(posdebfirstdomaine+1,posfinfirstdomaine)
posonedomaine=document.domain.toUpperCase().indexOf(onedomaine.toUpperCase(),0)
posdebfirstdomaine=posfinfirstdomaine
}
}
if (posonedomaine!=-1)
{
if (document.domain.length-posonedomaine-onedomaine.length==0)
{
if (document.cookie.indexOf("DFC=")==-1)
{
document.cookie = "DFC="+document.domain+"; expires=" + expires.toGMTString() + "; path=/; domain="+onedomaine
if (document.cookie.indexOf("DFC=")==-1)
param="?c=^off^&d=^"+document.domain+"^&r=^"+document.referrer
else
param="?c=^on^&d=^"+document.domain+"^&r=^"+document.referrer
param=param.substring(1,210)
param=param+"^\" border=0>"
document.write("<img src=\"http://bim.monde-diplomatique.fr/img/"+Math.random()*1000000000+".gif"+param)
}
else
{
document.cookie = "DFC="+document.domain+"; expires=" + expires.toGMTString() + "; path=/; domain="+onedomaine
}
}
}
}
