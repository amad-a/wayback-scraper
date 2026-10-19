var adimg = new Array(
  "http://ads.smartclicks.com/%d/B063910/smartbanner",
  "http://ads.amazingmedia.com/adserver.exe/SITE=wmmax/AREA=NONRICH&x=%d",
  "http://servedby.advertising.com/site=739/bnum=%d/bins=1/rich=0",
  "http://ads.datais.com/ads/ad.cgi?macleod-ad9%d&cnc=true",
  "http://ads.datais.com/ads/ad.cgi?macleod-ad%d&cnc=true",
  "http://ads.clickagents.com/cgibin/banner.ca?maxpages.1%d",
  "http://ads.clickagents.com/cgibin/banner.ca?maxpages.%d",
  "http://www.adclub.net/cgi-bin/view/maxpages/net/1/%d/",
  "http://imgworks.adbureau.net/accipiter/adserver.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=120X60?x=%d",
  "http://imgworks.adbureau.net/accipiter/adserver.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=468X60?x=%d",
  "http://imgworks.adbureau.net/accipiter/adserver.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=468X60?y=%d",
  "http://imgworks.adbureau.net/accipiter/adserver.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=468X60?z=%d",
  "http://servedby.advertising.com/site=739/size=120060/bnum=%d/bins=1/rich=0");

var adlnk = new Array(
  "http://ads.smartclicks.com/%d/B063910/smartsite",
  "http://ads.amazingmedia.com/adclick.exe/SITE=wmmax/AREA=NONRICH&x=%d",
  "http://servedby.advertising.com/click/site=739/bnum=%d",
  "http://ads.datais.com/ads/ad.cgi?macleod-link9%d&cnc=true",
  "http://ads.datais.com/ads/ad.cgi?macleod-link%d&cnc=true",
  "http://ads.clickagents.com/cgibin/click.ca?maxpages.1%d",
  "http://ads.clickagents.com/cgibin/click.ca?maxpages.%d",
  "http://www.adclub.net/cgi-bin/go/maxpages/net/1/%d/",
  "http://imgworks.adbureau.net/accipiter/adclick.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=120X60?x=%d",
  "http://imgworks.adbureau.net/accipiter/adclick.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=468X60?x=%d",
  "http://imgworks.adbureau.net/accipiter/adclick.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=468X60?y=%d",
  "http://imgworks.adbureau.net/accipiter/adclick.exe/SITE=MAXPAGES/AREA=ECOMMERCEN/aamsz=468X60?z=%d",
  "http://servedby.advertising.com/click/site=739/bnum=%d?size=120060");

var adinit = false;
var adimgdoc = null;
var adlnkdoc = null;

function maxAdMatchSub(ad_array_str,ad_str)
{
  var inx;
  var s;

  inx = ad_array_str.indexOf("%");
  if (inx < 0)
    return false;

  return ad_array_str.substring(0,inx) == ad_str.substring(0,inx);
}

function maxAdInitSlot(ad_array,ad_str)
{
  var i;

  for (i = 0; i < ad_array.length; i++) {
    if (maxAdMatchSub(ad_array[i],ad_str))
      return i;
  }

  return -1;
}

function maxAdInit()
{
  var lenimg;
  var lenlnk;
  var i;

  if (adinit)
    return;

  lenimg = document.images.length;
  lenlnk = document.links.length;
  adimgdoc = new Array(lenimg);
  adlnkdoc = new Array(lenlnk);

  for (i = 0; i < lenimg; i++) {
    adimgdoc[i] = maxAdInitSlot(adimg,document.images[i].src);
  }

  for (i = 0; i < lenlnk; i++) {
    adlnkdoc[i] = maxAdInitSlot(adlnk,document.links[i].href);
  }

  adinit = true;
}

function maxAdRefresh()
{
  if (!document.images)
    return;

  if (!adinit)
    maxAdInit();

  var x = Math.round(Math.random() * 99999998) + 1;
  var i;
  var r = new RegExp("%d","g");

  if (x < 10000000) x += 10000000;
  for (i = 0; i < adimgdoc.length; i++) {
    if (adimgdoc[i] >= 0) {
      document.images[i].src = adimg[adimgdoc[i]].replace(r,x);
    }
  }

  for (i = 0; i < adlnkdoc.length; i++) {
    if (adlnkdoc[i] >= 0) {
      document.links[i].href = adlnk[adlnkdoc[i]].replace(r,x);
    }
  }
}
