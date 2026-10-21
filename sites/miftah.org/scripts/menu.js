//------------------------------------------------------------------------------------------------------------
//
//	Global variables.
//		myLink - take a link passed from the left nav menu to link up whole rollover
//	Functions.
//		divObj(divID) - create .css property to divID
//		handler(e) - captures the mousedown event on the window for nav rollover.
//		hideShow(divID, vis) - hides/shows divID opposite to the value in vis
//		killtime (divID) - clears timeout and hides submenu, called from subNavShow
//		mapSync(divID, action) - syncs map to menu item (divID) with state of action (valid value: 'on')
//		setLink(menuLink) - sets myLink = menuLink if netscape for nav rollover workaround
//		subNavHide(divID) - hides divID subnav onmouseout of main menu
//		subNavShow(divID,main) - shows divID subnav referenced from main menu element main (e.g. '01' for td01)
//		subOut(divID) - hides sub menu divID onmouseout
//		subOver(main) - clears timeout on sub menu and keeps main menu item (main) highlighted
//		update() - called from subNavHide to update global vars and submenu visibility
//
//------------------------------------------------------------------------------------------------------------




//------------------------------------------------------------------------------------------------------------
// Global Variables
//------------------------------------------------------------------------------------------------------------

var myLink;

if (is.ns) {
	window.captureEvents(Event.MOUSEDOWN);
	window.onmousedown = handler;
}

//------------------------------------------------------------------------------------------------------------
// Functions
//------------------------------------------------------------------------------------------------------------

function divObj(divID) {
	dObj = findObj(divID);
	if (is.ns && !is.ns5) this.css = dObj;
  else if (is.ns5 || is.ie) this.css = dObj.style;
}

function handler(e) {
	if (is.ns) {
		if (myLink) {
			location.href = myLink;
			return false;
		}
	}
}

function hideShow(divID, vis) {
  layerObj = new divObj(divID);
  
  if ((vis == 'hide') || (vis == 'hidden')) {
    setVis = 'visible';
  } else if ((vis == 'show') || (vis == 'visible')) {
    setVis = 'hide';
  } else if (vis == ''){
    setVis='visible';
  } else {
    setVis='visible';
  }
  if (setVis == 'hide' && (is.ie || is.ns5)) setVis='hidden';
  layerObj.css.visibility = setVis;
}

function killtime (divID){
	clearTimeout(delay);
  hideShow(divID, layerObj.css.visibility);
}

function mapSync(divID, action) {
	if(action == 'on') {
		if(is.ns && !is.ns5) {
			divID = 'lyr' + divID;
			myObj = findObj(divID);
			myObj.bgColor = bgActive;
		} else {
			divID = 'td' + divID;
			myObj = findObj(divID);
			myObj.style.backgroundColor = bgActive;
		}
	} else {
		if(is.ns && !is.ns5) {
			divID = 'lyr' + divID;
			myObj = findObj(divID);
			myObj.bgColor = bgNormal;
		} else {
			divID = 'td' + divID;
			myObj = findObj(divID);
			myObj.style.backgroundColor = bgNormal;
		}
	}
}

function setLinkNull () {
myLink = '';
}

function  setLink(menuLink) {
	if (is.ns) {
		myLink = menuLink;
	}
}

function subNavHide(divID) {
	if (divID == '') return(bgNormal);
	var waitTime = 100;
	
  layerObj = new divObj(divID)
	delay = setTimeout("update();", waitTime);
	
	if (is.ns) {
		myLink = '';
	}
	
  return(bgNormal);
}

function subNavHide2(divID) {
	if (divID == '') return(bgNormal2);
	var waitTime = 100;
	
  layerObj = new divObj(divID)
	delay = setTimeout("update();", waitTime);
	
	if (is.ns) {
		myLink = '';
	}
	
  return(bgNormal2);
}

function subNavShow(divID,main) {

	if (activated){
		if(is.ns && !is.ns5) {
			myObj = findObj(activated);
			myObj.bgColor = bgNormal;
		} else {
			myObj = findObj(activated);
			myObj.style.backgroundColor = bgNormal;
		}
		
	}
	
	
	
	// start condition for keeping main menu activated
	if (main) {
		if(is.ns && !is.ns5) {
			main = 'lyr' + main;
			myObj = findObj(main);
			myObj.bgColor = bgActive;
			activated = main;
		} else {
			main = 'td' + main;
			myObj = findObj(main);
			myObj.style.backgroundColor = bgActive;
			activated = main;
		}
			}
	// end condition for keeping main menu activated
	
	if (divID != '') {
		if (delay > 0) {
	    killtime(divIDOld);
	  }
	  
		divIDOld = divID;
		layerObj = new divObj(divID);
	  var vis = layerObj.css.visibility;
	
		delay = 0;
		hideShow(divID, vis);
	}

  return(bgActive);
}

function subOut(divID) {
  layerObj = new divObj(divID)
	delay = setTimeout("update();", 250);
  return(bgNormal);
  
  if (is.ns) {
		myLink = '';
	}
		
}

function subOver(main,menuLink) {
	if (activated){
		if(is.ns && !is.ns5) {
			myObj = findObj(activated);
			myObj.bgColor = bgNormal;
		} else {
			myObj = findObj(activated);
			myObj.style.backgroundColor = bgNormal;
		}
		
	}
	
	// start condition for keeping main menu activated
	if (main) {
		if(is.ns && !is.ns5) {
			main = 'lyr' + main;
			myObj = findObj(main);
			myObj.bgColor = bgActive;
			activated = main;
		} else {
			main = 'td' + main;
			myObj = findObj(main);
			myObj.style.backgroundColor = bgActive;
			activated = main;
		}
	}
	// end condition for keeping main menu activated
	
	if (is.ns) {
		myLink = menuLink;
	}
	
	if (delay > 0) {
		clearTimeout(delay);
	}
	
	return(bgActive);
}

function update() {
	 hideShow(divIDOld, 'show');
   delay = 0;
		if(is.ns && !is.ns5) {
			myObj = findObj(activated);
			myObj.bgColor = bgNormal;
		} else {
			myObj = findObj(activated);
			myObj.style.backgroundColor = bgNormal;
		}
		
		if (is.ns) {
			myLink = '';
		}
}
