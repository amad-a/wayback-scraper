// Copyright 1999, 2000 Flycast Communications. All rights reserved.
// Patent Pending
// Version 3.5.15

FlycastLoaded		= true;
FlycastRandom		= 0;
FlycastClickTarget	= "_top";
FlycastFoundMSIE	= navigator.userAgent.indexOf("MSIE") >= 0;
FlycastFoundMSIE2	= navigator.userAgent.indexOf("MSIE2") >= 0 || navigator.userAgent.indexOf("MSIE 2") >= 0;
FlycastFoundMSIE3	= navigator.userAgent.indexOf("MSIE 3") >= 0;
FlycastFoundNN		= navigator.userAgent.indexOf("Mozilla/") >= 0 && !FlycastFoundMSIE;
FlycastFoundNN2		= navigator.userAgent.indexOf("Mozilla/2.") >= 0 && !FlycastFoundMSIE;
FlycastFoundNN3		= navigator.userAgent.indexOf("Mozilla/3.") >= 0 && !FlycastFoundMSIE;
FlycastModernJS		= !(FlycastFoundNN3 || FlycastFoundMSIE3);

function FlycastReplace(str, chr, replacement)
{	//more universally supported than str.replace(chr, replacement)
	var	x	= str.split(chr);
	var	y	= x[0];
	for (i = 1; i < x.length; i++)
	{
		y	+= replacement;
		y	+= x[i];
	}
	return	y;
}

function FlycastDeliverAd ()
{
	FlycastAdServer		= "http://ad-adex3.flycast.com/server";

	if (FlycastNewAd) {
		FlycastNow		= new Date();
		FlycastRandom	= FlycastNow.getTime();
		FlycastRandom	= FlycastRandom % 10000000;
		if (FlycastModernJS)
		{
			FlycastRandom	+= Math.floor(Math.random() * 100);
		}
	}

	var	httpHeader			= "http://";
	var	httpReferrerIndex	= location.href.indexOf(httpHeader);

	if ((httpReferrerIndex >= 0) && FlycastModernJS)
	{
		httpReferrerIndex	+= httpHeader.length;
		httpReferrer	= location.href.substr(httpReferrerIndex);
		//first, truncate queryString
		httpReferrer	= httpReferrer.split('?')[0];
		//substitute ascii for potentially unparseable characters
		httpReferrer	= FlycastReplace(httpReferrer, ";", "\%3b");	//replace (globally) ';' with "%3b"
		httpReferrer	= FlycastReplace(httpReferrer, "=", "\%3d");	//replace (globally) '=' with "%3d"
		httpReferrer	= FlycastReplace(httpReferrer, "/", "\%2f");	//replace (globally) '/' with "%2f"
		FlycastSiteInfo	= FlycastSite + "/" + FlycastPage + "/;referrer=" + httpReferrer + ";/" + FlycastRandom;
	}
	else
	{
		FlycastSiteInfo	= FlycastSite + "/" + FlycastPage + "/" + FlycastRandom;
	}

	if (FlycastFoundMSIE2) {
		document.write('<A HREF="' + FlycastAdServer + '/click/' +  FlycastSiteInfo + '"><IMG SRC="' + FlycastAdServer + '/ad/' +  FlycastSiteInfo + '" scrolling="no" marginwidth=0 marginheight=0 frameborder=0 vspace=0 hspace=0 width=' + FlycastWidth + ' height=' + FlycastHeight + '></A>');
	}
	else if (FlycastFoundMSIE)  {
		document.write('<IFRAME SRC="' + FlycastAdServer + '/iframe/' +  FlycastSiteInfo + '" scrolling="no" marginwidth=0 marginheight=0 frameborder=0 vspace=0 hspace=0 width=' + FlycastWidth + ' height=' + FlycastHeight + '></IFRAME>');
	}
	else {
		document.write('<S' + 'CRIPT SRC="' + FlycastAdServer + '/js/' +  FlycastSiteInfo + '" LANGUAGE=JAVASCRIPT></SCRIPT>');
	}
}

if (FlycastFoundNN3 && FlycastPrintTag)
{
	FlycastLoaded	= false;
	FlycastDeliverAd();
}
