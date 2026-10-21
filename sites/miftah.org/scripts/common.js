//------------------------------------------------------------------------------------------------------------
//
//	Global variables.
//	Functions.
//		browserCheck() - object to determine browser
//		findObj(n, d) - finds object named n in document d (optional)
//		launchBrowserSpecificEvent(link,hi,wi,rs,hn,wn) - gencast streaming function
//		mediaKitRequest() - opens a new browser window for the media kit request form
//		preload() - preloads any number of images with paths passed as arguments
//		resizeFix(init) - Netscape 4.0 Resize fix, must be called in <head> of html page as resizeFix(true)
//		selectAll() - selects/deselects all check boxes on the BOS admin form
//		setTarget() - submits form to return email from BOS entry form
//		swap(image, over) - swaps button named image in left nav to mouseover state (over: boolean) if over
//		swapMap(country) - swaps the map to country passed as its argument
//
//------------------------------------------------------------------------------------------------------------




//------------------------------------------------------------------------------------------------------------
// Global Variables
//------------------------------------------------------------------------------------------------------------

var is = new browserCheck();
var delay = 0;
var bgNormal='#C2CED5';
var bgNormal2='#E8DCC1';
var bgActive='#A2AEB5';
var bgActive2='#333333';
var divID = 0;
var divIDOld = 0;
var activated = 0;

maps = new Array();
maps[0] = new Image();
maps[0].src = '/images/map_northamerica.gif';
maps[1] = new Image();
maps[1].src = '/images/map_southamerica.gif';
maps[2] = new Image();
maps[2].src = '/images/map_europe.gif';
maps[3] = new Image();
maps[3].src = '/images/map_africa.gif';
maps[4] = new Image();
maps[4].src = '/images/map_asia.gif';
maps[5] = new Image();
maps[5].src = '/images/map_europe.gif';
maps[6] = new Image();
maps[6].src = '/images/map_australia.gif';

//------------------------------------------------------------------------------------------------------------
// Functions
//------------------------------------------------------------------------------------------------------------

function browserCheck() {
	var b = navigator.appName;
	if (b=="Netscape") this.b = "ns"
	else if (b=="Microsoft Internet Explorer") this.b = "ie"
	else this.b = b
	this.version = navigator.appVersion;
	this.v = parseInt(this.version);
	this.ns = (this.b=="ns" && this.v>=4);
	this.ns4 = (this.b=="ns" && this.v==4);
	this.ns5 = (this.b=="ns" && this.v==5);
	this.ie = (this.b=="ie" && this.v>=4);
	this.ie4 = (this.version.indexOf('MSIE 4')>0);
	this.ie5 = (this.version.indexOf('MSIE 5')>0);
	this.min = (this.ns||this.ie);
}

function findObj(n, d) { //v3.0
  var p,i,x;
	if(!d) d=document;
	if(!(x=d[n])&&d.all) x=d.all[n]; 
	for (i=0;!x&&i<d.forms.length;i++) x=d.forms[i][n];
  for(i=0;!x&&d.layers&&i<d.layers.length;i++) x=findObj(n,d.layers[i].document);
	return x;
}

function launchBrowserSpecificEvent(link,hi,wi,rs,hn,wn) {
	var ver = navigator.appVersion;
	if (!hi || hi == "") hi="550"
	if (!wi || wi == "") wi="760"
	if (!hn || hn == "") hn="550"
	if (!wn || wn == "") wn="760"
	
	if (ver.indexOf("MSIE") != -1)
	{
	     eventSrcB="newWin=window.open('"+link+"_ie.html','EVENT','width="+wi+",height="+hi+",left=1,top=1,screenX=1,screenY=1"
	}else{
	     eventSrcB="newWin=window.open('"+link+"_netscape.html','EVENT','width="+wn+",height="+hn+",left=1,top=1,screenX=1,screenY=1"
	}
	  if ( !rs || rs == "" ) {
	    eventSrcB+="')"
	  } else {
	    eventSrcB+=",resizable=yes')"
	  }
	  eval(eventSrcB)
}

function mediaKitRequest() {
	props = "left=50,top=50,width=350,height=500,status=no,scrollbars=yes";
	window.open("/misc/media_kit_download.php","newwin",props);
}

function preload() {
	args = preload.arguments;
	for (i=0;i<args.length;i++) {
		preloaded[i] = new Image();
		preloaded[i].src = args[i];
	}
}

function resizeFix(init) {  //reloads the window if Nav4 resized
  if (init==true) with (navigator) {if ((appName=="Netscape")&&(parseInt(appVersion)==4)) {
    document.mm_pgW=innerWidth; document.mm_pgH=innerHeight; onresize=resizeFix; }}
  else if (innerWidth!=document.mm_pgW || innerHeight!=document.mm_pgH) location.reload();
}

function selectAll() {
	if (document.forms['showSelect'].mybutton.value == "Select All") {
		document.forms['showSelect'].date.checked = true;
		document.forms['showSelect'].bullets.checked = true;
		document.forms['showSelect'].show.checked = true;
		document.forms['showSelect'].custType.checked = true;
		document.forms['showSelect'].cust_ref.checked = true;
		document.forms['showSelect'].category.checked = true;
		document.forms['showSelect'].contact.checked = true;
		document.forms['showSelect'].prod_name.checked = true;
		document.forms['showSelect'].email.checked = true;
		document.forms['showSelect'].vendor.checked = true;
		document.forms['showSelect'].version.checked = true;
		document.forms['showSelect'].founding.checked = true;
		document.forms['showSelect'].booth.checked = true;
		document.forms['showSelect'].employees.checked = true;
		document.forms['showSelect'].location.checked = true;
		document.forms['showSelect'].fortune.checked = true;
		document.forms['showSelect'].description.checked = true;
		document.forms['showSelect'].revenues.checked = true;
		document.forms['showSelect'].download.checked = true;
		document.forms['showSelect'].mybutton.value = "Deselect All";
	} else {
		document.forms['showSelect'].date.checked = false;
		document.forms['showSelect'].bullets.checked = false;
		document.forms['showSelect'].show.checked = false;
		document.forms['showSelect'].custType.checked = false;
		document.forms['showSelect'].cust_ref.checked = false;
		document.forms['showSelect'].category.checked = false;
		document.forms['showSelect'].contact.checked = false;
		document.forms['showSelect'].prod_name.checked = false;
		document.forms['showSelect'].email.checked = false;
		document.forms['showSelect'].vendor.checked = false;
		document.forms['showSelect'].version.checked = false;
		document.forms['showSelect'].founding.checked = false;
		document.forms['showSelect'].booth.checked = false;
		document.forms['showSelect'].employees.checked = false;
		document.forms['showSelect'].location.checked = false;
		document.forms['showSelect'].fortune.checked = false;
		document.forms['showSelect'].description.checked = false;
		document.forms['showSelect'].revenues.checked = false;
		document.forms['showSelect'].download.checked = false;
		document.forms['showSelect'].mybutton.value = "Select All";
	}
}

function setTarget() {
	if (document.forms['emailer'].show.value != "") {
		emailwin = window.open("/bestofshow/blank.php",'emailwin','left='+screen.width+',top='+screen.height);
		document.forms['emailer'].submit();
		document.forms['emailer'].show.value = "";
	}
}

function swap(image, over) {
	if (image.indexOf('ln') != -1) nested = 1;

	if (nested && is.ns) {
		if (over) {
			document['leftnav'].document.images[image].src = document['leftnav'].document.images[image].src.replace(/_off/gi, '_over');
		} else {
			document['leftnav'].document.images[image].src = document['leftnav'].document.images[image].src.replace(/_over/gi, '_off');
		}
	} else {
		if (over) {
			document.images[image].src = document.images[image].src.replace(/_off/gi, '_over');
		} else {
			document.images[image].src = document.images[image].src.replace(/_over/gi, '_off');
		}
	}
}

function swapMap(country) {
	if (country) {
		if(is.ns) {
			document.map.document.mapimg.src = '/images/map_'+country+'.gif';
		} else {
			document.images['mapimg'].src = '/images/map_'+country+'.gif';
		}
	} else {
		if(is.ns) {
			document.map.document.mapimg.src = '/images/map_off.gif';
		} else {
			document.images['mapimg'].src = '/images/map_off.gif';
		}
	}
}
//--------------------------------------------------------------------------------
// Window Popup Function
//--------------------------------------------------------------------------------

function popUpTheWindow (popupWindowName, popwidth, popheight, cookieName) {
   if ( cookieName == "" )cookieName="internetworldAll";   // Setup cookie name...
   writeIt(cookieName);
   
   if (ReadCookie(cookieName) == "1")  {
      if ( popupWindowName == "" ) { popupWindowName="index.html"; }   
	  if ( popwidth == "" ) { popwidth  ="500"; }
      if ( popheight == "" ) { popheight ="300"; }
      window.open(popupWindowName,'Popup_Window','resizable=yes,status=no,toolbar=no,location=no,menu=no,scrollbars=no,width='+popwidth+',height='+popheight);
   }
}

function ReadCookie (CookieName) {
  var CookieString = document.cookie;
  var CookieSet = CookieString.split (';');
  var SetSize = CookieSet.length;
  var CookiePieces
  var ReturnValue = "";
  var x = 0;

  for (x = 0; ((x < SetSize) && (ReturnValue == "")); x++) {
    CookiePieces = CookieSet[x].split ('=');
    if (CookiePieces[0].substring (0,1) == ' ') {
      CookiePieces[0] = CookiePieces[0].substring (1, CookiePieces[0].length);
    }
    if (CookiePieces[0] == CookieName) {
      ReturnValue = CookiePieces[1];
    }
  }
  return ReturnValue;;
}

function WriteCookie (cookieName, cookieValue, expiry) {
   var expDate = new Date();

   if(expiry) {
      expDate.setTime (expDate.getTime() + expiry);
      document.cookie = cookieName + "=" + escape (cookieValue) + "; expires=" + expDate.toGMTString();
    }
   else {
      document.cookie = cookieName + "=" + escape (cookieValue); alert("thisone");
   }
}

function writeIt(cookieName) { // ***** Prepare information to be written in the cookie.
  daysToLast = "1";
  myValue = ReadCookie(cookieName);
  myValue++;
  if (myValue <= 1 || myValue =="NaN") {
     WriteCookie(cookieName, myValue, 1000 * 60 * 60 * 24 * daysToLast );
  } else {
     WriteCookie(cookieName, myValue, 1000 * 60 * 60 * 24 * .41 );
  }

  // alert("wrote cookie: " + myValue);
}
