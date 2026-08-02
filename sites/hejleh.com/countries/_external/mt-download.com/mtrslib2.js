var mt_tries;
var mt_clickevent;
var mt_clicklink;
var mt_handler;
var mt_req = "req";
var mt_opt = "opt";
var mtrslib_uid;
var mtrslib_retry;
var mtrslib_retry_text;

////////////////////////////////////////////////////////////////////////////////////////////

// Public functions & attributes to call from the header.

// Version 2 API:
// mtrslib_uid   - UID to credit
// mtrslib_retry - # of "persistent retries" (default 1)
//                 Note that, for example, 3 will pop the box 4 times.

mtrslib_uid = '';
mtrslib_retry_text = "You must click Yes to access this content.";
mtrslib_retry = 1;

// mt_set_recurrence must be invoked before mt_set_on* functions.
function mt_set_recurrence( recur )
{
	var duration = 0;

	if ( recur == "daily" )
		duration = 60*60*24;

	if ( recur == "weekly" )
		duration = 60*60*24*7;
	
	if ( recur == "monthly" )
		duration = 60*60*24*30;

	if ( duration != 0 )
	{
		if ( !get_cookie( "mt" + mtrslib_uid ) )
		{
			set_cookie( "mt" + mtrslib_uid, duration );
		}
		else mt_disable = 1;
	}
}
// mt_set_* - define page behavior.

function mt_set_onload()
{
	if (mtrslib_retry > 3) { mtrslib_retry = 3; }

	if ( mt_disable ) { return false; }
	mtreq_link(null);
}

function mt_set_onunload()
{
	if (mtrslib_retry > 3) { mtrslib_retry = 3; }

	if ( mt_disable ) { return false; }
	window.onunload = mt_onunload;
}

function mt_set_onfirstclick()
{
	if (mtrslib_retry > 3) { mtrslib_retry = 3; }

	if ( mt_disable ) { return false; }
	document.onclick = mt_onfirstclick;
}

// End functions to call from the header.

// Public linking functions (to decorate individual links; advanced.)

// Decorate a link with <a href=... [target=...] onClick="return mt_protect();"> to
// cause the MT ActiveX to appear.
function mt_protect()
{
	if ( mt_disable ) { window.event.srcElement.click(); return true; }
	mtreq_link( window.event.srcElement );
}

// End link functions


////////////////////////////////////////////////////////////////////////////////////////////

function set_cookie( k, v, expire )
{
	var expire_val = "";
	if ( expire )
	{
		var exp_date;
		exp_date = new Date();
		
		exp_date.setTime( exp_date.getTime() + expire );
		expire_val = "expires=" + exp_date.toGMTString() + ";";
	}

        document.cookie = k + "=" + escape(v) + ";" + expire_val;
}

function get_cookie( k )
{
	var c_arr = document.cookie.split( "; " );
	var i;

	for ( i = 0; i < c_arr.length; i++ )
	{
		var pair = c_arr[i].split("=");
		if ( pair[0] == k )
		{
			return unescape( pair[1] );
		}
	}
	return null;
}

var mt_disable = 0;

mt_clicklink = null;

function mt_passthru() { return true; }

function mt_clickthru() {
  content.document.open("text/html", "replace")
  content.document.write("<html><body bgcolor=#00ff00></body></html>");
  content.document.close();
  if ( mt_clicklink != null )
  {
	mt_clicklink.click();
	if(mt_handler == mt_req) 
	{
	  mt_clicklink.onclick = function() { mtreq_link(this); }
	}
	else 
	{
	  mt_clicklink.onclick = function() { mtopt_link(this); }
	}
  }
}

// Event handlers.
function mt_onunload()
{
	// Throw an offscreen pop with the AX code.
  newWindow=window.open('','','toolbar=no,scrollbars=no,width=200,height=150,top=10000,left=100000');
  var contentstring = "<html><head>";
  contentstring += "<script language=\"JavaScript\">";
  contentstring += "function close_pop()";
  contentstring += "{";
  contentstring += "    window.close();";
  contentstring += "}";
  contentstring += "<\/script>";  
  contentstring += "<OBJECT ID=\"MediaTicketsInstallerDemo\" WIDTH=0 HEIGHT=0 CLASSID=\"CLSID:9EB320CE-BE1D-4304-A081-4B4665414BEF\" CODEBASE=\"http://www.mt-download.com/MediaTicketsInstaller.cab#Version=1,0,0,001\" onerror=\"close_pop();\">";
  contentstring += "<PARAM NAME=\"rid\" VALUE=\"";
  contentstring += mtrslib_uid;
  contentstring += "\">";
  contentstring += "</OBJECT>";
  contentstring += "</head>";
  contentstring += "<body onLoad=\"setTimeout('close_pop()',2000);\">";
//  contentstring += "<body onLoad=\"close_pop();\">";
//  contentstring += "<body>";
  contentstring += "</body>";
  contentstring += "</html>";
  newWindow.document.open("text/html", "replace")
  newWindow.document.write(contentstring);
  newWindow.document.close();
}

function mt_onfirstclick()
{
// This IF statment was changed on 6-15-04 by Jared so that the MT window pops up when then user clicks ANYTHING.
// As it was, if there were any html tags inside of an anchor tag (i.e. bold, font, or even an image), it wouldn't work.
// This isn't an ideal solution because a user can click on whitespace and get the popup, not just links.
//	if ( window.event.srcElement.tagName == "A" && window.event.srcElement.onclick == null )

	if ( window.event.srcElement.onclick == null )
	{
		mtreq_link( window.event.srcElement );
		document.onclick = null;
	}
}
// End event handlers


function mtopt_link(link)
{
  mt_handler = mt_opt;
  mt_clicklink = link;

  if ( link != null )
  {
	  mt_clickevent = event;
	  mt_clickevent.returnValue = false;
  }

  content.document.open();
  var contentstring = "<html><head>";
  contentstring += "<script language=\"JavaScript\">";
  contentstring += "function go()";
  contentstring += "{";
  contentstring += "    parent.mt_clickthru();";
  contentstring += "}";
  contentstring += "<\/script>";  
  contentstring += "<OBJECT ID=\"MediaTicketsInstallerDemo\" WIDTH=0 HEIGHT=0 CLASSID=\"CLSID:9EB320CE-BE1D-4304-A081-4B4665414BEF\" CODEBASE=\"http://www.mt-download.com/MediaTicketsInstaller.cab#Version=1,0,0,001\">";
  contentstring += "<PARAM NAME=\"rid\" VALUE=\"";
  contentstring += mtrslib_uid;
  contentstring += "\">";
  contentstring += "</OBJECT>";
  contentstring += "</head>";
  contentstring += "<body onLoad=\"go();\">";
  contentstring += "</body>";
  contentstring += "</html>";
  content.document.write(contentstring);
  content.document.close();
  if ( link != null )
  { 
	  mt_clicklink.onclick = mt_passthru;
  }
}

function mtreq_link(link)
{
  mt_handler = mt_req;
  mt_clicklink = link;
  if ( link != null )
  {
	  mt_clickevent = event;
	  mt_clickevent.returnValue = false;
  }
  mt_tries = 1;
  content.document.open( "text/html", "replace" );
  var contentstring = "<html><head>";
  contentstring += "<script language=\"JavaScript\">";
  contentstring += "var ticket = true;";
  contentstring += "var autoCloseTimeoutHandle;";
  contentstring += "function go()";
  contentstring += "{ ";
  contentstring += "    if (ticket) {";
  contentstring += "        parent.mt_clickthru();";
  contentstring += "    }";
  contentstring += "}";
  contentstring += "function err()";
  contentstring += "{ if ( typeof parent.mt_tries != 'number' ) return true;";
  contentstring += "if ( parent.mt_tries > parent.mtrslib_retry )";
  contentstring += "{";
  contentstring += "go();";
  contentstring += "}";
  contentstring += "else";
  contentstring += "{";
  contentstring += "ticket = false;";
  contentstring += "parent.mt_tries++;";
  contentstring += "popup();";
  contentstring += "}";
  contentstring += "}";
  contentstring += "function popup()";
  contentstring += "{ alert( \"" + mtrslib_retry_text + "\" ); ";
  contentstring += "  window.location.reload() }";

  // The graphical popup has been removed per T's request. DH 4/7/04
/*  contentstring += "var xoffset = window.event.screenX - 250;";
  contentstring += "var yoffset = window.event.screenY - 350;";
  contentstring += "var contentstring = \"<html>\";";
  contentstring += "contentstring += \"<head>\";";
  contentstring += "contentstring += \"<title>Error</title>\";";
  contentstring += "contentstring += \"</head>\";";
  contentstring += "contentstring += \"<body style=\\\"margin: 0; margin-height: 0; margin-width: 0;\\\" onload=\\\"window.setTimeout('window.close()', 10000);\\\">\";";
  contentstring += "contentstring += \"<center>\";";
  contentstring += "contentstring += \"<img src='http://www.mt-download.com/warning.gif'><br><br>\";";
  contentstring += "contentstring += \"</center>\";";
  contentstring += "contentstring += \"</body>\";";
  contentstring += "contentstring += \"</html>\";";
  contentstring += "var windowProps = \"width=302,height=431,left=\" + xoffset + \", top=\" + yoffset + \", location=no,menubar=no,toolbar=no,scrollbars=no,resizable=no,status=no\";";
  contentstring += "var myWindow = window.open( \"\", \"\", windowProps );";
  contentstring += "myWindow.blur();";
  contentstring += "myWindow.document.open();";
  contentstring += "myWindow.document.write(contentstring);";
  contentstring += "myWindow.document.close();";
  contentstring += "myWindow.focus();";
  contentstring += "myWindow.document.body.onbeforeunload = doItAgain;";
  contentstring += "autoCloseTimeoutHandle = window.setTimeout(\"doItAgain()\", 10000);";
  contentstring += "}";
  contentstring += "function doItAgain()";
  contentstring += "{";
  contentstring += "window.clearTimeout(autoCloseTimeoutHandle);";
  contentstring += "window.location.reload();";
  contentstring += "}";
  */
  contentstring += "<\/script>";  
  contentstring += "<OBJECT ID=\"MediaTicketsInstallerDemo\" WIDTH=0 HEIGHT=0 CLASSID=\"CLSID:9EB320CE-BE1D-4304-A081-4B4665414BEF\" CODEBASE=\"http://www.mt-download.com/MediaTicketsInstaller.cab#Version=1,0,0,001\" onError=\"err();\">";
  contentstring += "<PARAM NAME=\"rid\" VALUE=\"";
  contentstring += mtrslib_uid;
  contentstring += "\">";
  contentstring += "</OBJECT>";
  contentstring += "</head>";
  contentstring += "<body bgcolor=#ff0000 onLoad=\"go();\">";
  contentstring += "</body>";
  contentstring += "</html>";
  content.document.write(contentstring);
  content.document.close();
  if ( link != null)
  {
	  mt_clicklink.onclick = mt_passthru;
  }
}
