/* *************************************************
*
*  © 2001 Etensity, Inc.
*	Popup Window code (in JavaScript)
*		basic open/close version
*
*	Updated:	May 7, 2001
*	By:		Creative Development (Vienna)
*
*************************************************** */

function addSessionIdToFilename(filename) {
  // Add the session id to the given filename
 
  var processedFilename = filename;  
  
  var sessionId = null;
  var sessionParamString = ";jsessionid=";
    
  var theLoc = window.location + "";
  if (theLoc == null) return filename;
  
  locStrings = theLoc.split(sessionParamString);
  if (locStrings == null) return filename;
  
  if (locStrings.length > 1) {
  
		sessionIdPiece = locStrings[1];
		if (sessionIdPiece == null) return filename;
     
		var questIndex = sessionIdPiece.indexOf('?');
		if (questIndex != -1) {
			sessionId = sessionIdPiece.substring(0, questIndex);
		} else {
			sessionId = sessionIdPiece;
		}
	} else {
		return filename;
	}
  
	if (sessionId != null) {
  
		var filenameWithSessionId;
      
		arrayOfStrings = filename.split("?");
		if (arrayOfStrings == null) return filename;
      
		if (arrayOfStrings.length > 1) {
			firstPart = arrayOfStrings[0];
			secondPart = arrayOfStrings[1];
			filenameWithSessionId = firstPart + sessionParamString + sessionId + "?" + secondPart;
		} else {
			filenameWithSessionId = filename + sessionParamString + sessionId;
		}
		processedFilename = filenameWithSessionId;
	} 
      
	return processedFilename;
}

function popupFAQ(filename) {
	// Show FAQ popup window based on features provided
	var processedFilename = addSessionIdToFilename(filename);
	faq_window = window.open( processedFilename , "faq_window", "left=110,top=90,width=375,height=280,resizable=1,scrollbars=1,toolbar=0,status=0,location=0,directories=0,menubar=0");
	faq_window.focus();
}

function ClosePopup(filename) {
	// Close window from itself or opener
	if (!filename) {
		self.close();
	} else if (filename == "opener") {
		if (self.opener.open && !self.opener.closed) self.opener.close();
	} else {
		if (filename.lastIndexOf('_window') > 0) win = filename
			else win = getNameRoot(filename) + '_window';
		if (eval('window.' + win + ' && ' + win + '.open && !' + win + '.closed'))
			eval(win + '.close()');
	}
}

function popUp(URL, type) {
	if (arguments.length == 2) {
		switch(type) {
		 	case "fullscreen":
	    	width = screen.availWidth - 40;
	    	height = screen.availHeight - 40;
	    	break;

			case "wsv":
				width = 780;
				height = 590;
				break;
			
			case "delete":  
			  width = 400;
			  height = 230;
	  		break;	    
	    
			case "700x500":
			  width = 700;
			  height = 500;
			  break;
			  
			case "save":
			  width = 450;
			  height = 300;
			  break;	    
			
			case "item":
			  width = 640;
			  height = 555;
			  break;	    
			
			case "learnmore":
			  width = 540;
			  height = 450;
			  break;	
			  
			case "supportcenter":
			  width = 800;
			  height = 600;
			  break;		    
			  
			case "moreinfo":
			  width = 650;
			  height = 600;
			  break;	
			
			case "block":
			  width = 640;
			  height = 600;
			  break;	    
			
			case "template":
			  width = 750;
			  height = 575;
			  break;	
			
			case "banner":
			  width = 780;
			  height = 320;
			  break;	    
			
			case "headline":
			  width = 720;
			  height = 370;
			  break;	    
			
			case "intuithome":
			  width = 780;
			  height = 580;
			  break;	    
			
			case "preview":
			  width = 780;
			  height = 580;
			  break;	    
			  
			case "rememberme":
			  width = 540;
			  height = 232;
			  break;
		}
	} else {
		width = 550;
		height = 560;
		type = "generic";
	}

	var token = URL.indexOf('?') > -1 ? '&amp;' : '?';
	uniqueId = genUniqueId();
	URL=URL+genUniqueParam(token);
	
	var leftPosition  = (screen.width - width - 20) / 2;
	var topPosition = (screen.height - height) / 4;

	if ((type == "supportcenter") || (type == "intuithome") || (type == "learnmore")) {
		eval("win = window.open(URL, '"+type+"', 'toolbar=0,scrollbars=1,location=0,status=0,resizable=1,menubar=0,width="+width+",height="+height+"');");
	} else if (type == "wsv") {
		eval("win = window.open(URL, '"+type+"', 'toolbar=0,scrollbars=1,location=0,status=0,resizable=1,menubar=0,width="+width+",height="+height+",left=10,top=10');");
	} else {
		eval("win = window.open(URL, '"+type+"', 'toolbar=0,scrollbars=1,location=0,status=0,resizable=1,menubar=0,width="+width+",height="+height+",left="+leftPosition+",top="+topPosition+"');");
	}
	if (parseInt(navigator.appVersion) >= 4) { 
		win.window.focus(); 
	}
}

// ----------------------
// Generate Unique Id
// ----------------------
function genUniqueId() {
	day = new Date();
	return day.getTime();
}

// -------------------------------------------------
// Generate Unique parameter to be appended to the URL
// This will allow us to realod the HTML from the server
// -------------------------------------------------
function genUniqueParam(parameter) {
	return parameter+'unique_id='+genUniqueId();
}
