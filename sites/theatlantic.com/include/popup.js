

//
//	create a set of campaigns and ads
//  
//  in the constructor...
//   advert[a] = new advert(a,b,c,d,e,f,g);
//  the values should be entered as follows...
//
//   a = a unique number identifying this ad (must be the same # in both instances of a)
//   b = the name of the ad (no spaces)
//   c = the name of the campaign the ad belongs to (no spaces)
//   d = the url of the ad to be opened
//   e = the width of the window to display the ad in
//   f = the height of the window to display the ad in
//   g = the "weight" of the ad
//       the default weight should be 1, if you would like the
//       ad in question to be twice as likely to appear, choose 2
//       a percentage likelihood for each can be determined
//       by dividing the weight in question by the total combined
//       weights of all ads
//
function init()
{
	advert[1] = new advert(1,"ptcinv14","subsoffer","/ads/popup-ptc-inv-14.htm",320,320,1);
	advert[2] = new advert(2,"ptcinv19","subsoffer","/ads/popup-ptc-inv-19.htm",320,320,1);
	advert[3] = new advert(3,"ptcinv24","subsoffer","/ads/popup-ptc-inv-24.htm",320,320,1);
}



//
//  some global variables you may want to change
//
//  specialWord = defines the "special campaign"
//  doPopUp = an emergency boolean that can disable all popup functionality
//  interval = time in seconds before another ad can be displayed
//  campLen = time in seconds that a campaign will last
//  includeSpecialWord = defines whether the "special campaign" ad will be displayed
//     to users not in the "special directory"
//  weighCampaigns = a boolean that determines whether or not to allow
//     the weight of individual ads effect the outcome of campaign selection
//
specialWord = "none";
doPopUp = true;
interval = 600;
campLen = 604800;
includeSpecialWord = true;
weighCampaigns = true;



//
//  creating new ad objects
//
function advert(adRefNum, adName, adCampaign, adURL, adWidth, adHeight, adWeight)
{
	this.adRefNum = adRefNum
	this.adName = adName;
	this.adCampaign = adCampaign;
	this.adURL = adURL;
	this.adWidth = adWidth;
	this.adHeight = adHeight;
	this.adWeight = adWeight;
	
	campaignListParse = ","+campaignList.toString()+",";
	
	if (campaignListParse.indexOf(","+adCampaign+",") == -1)
	{
		campaignNumAds[adCampaign] = adWeight;
		campaignList[campaignList.length] = adCampaign;	
	} else {
		campaignNumAds[adCampaign] += adWeight;	
	}
	if (adWeight>1)
	{
		for (x=0;x<adWeight;x++)
		{
			campaignAds[adCampaign+(campaignNumAds[adCampaign]-x)] = new campaignAds(adRefNum);
		}
	} else {
		campaignAds[adCampaign+campaignNumAds[adCampaign]] = new campaignAds(adRefNum);
	}
}


//
//  creating new ad campaigns
//
function campaignAds(adRefNum)
{
	this.adRefNum = adRefNum;
}


//
//  establish a set of global variables for internal use
//
popglobal = "";
useCampaign = "";
thisURL = location.toString();
campaignList = new Array();
campaignActive = new Array();
campaignUseList = new Array();
campaignList2 = new Array();
campaignNumAds = new Array();
campnow = "";
today = new Date();


//
//  begin trapping events
//
document.onmousedown = dontPop;


//
//  disable/enable popups for internal clicks
//
function dontPop(e)
{
	doPopUp = false;
	setTimeout("doPop()",1000);
}

function doPop()
{
	doPopUp = true;
}


//
//  random number generation
//
rnd.today = new Date();
rnd.seed = rnd.today.getTime();

function rnd()
{
	rnd.seed = (rnd.seed*9301+49297) % 233280;
	return rnd.seed/ (233280.0);
}

function rand(number)
{
	return Math.ceil(rnd()*number);
}


//
//  read cookies into useable bits
//
function parseCookies()
{
	allCookies = document.cookie;
	
	// get the popglobal cookie
	pos = allCookies.indexOf("popglobal=");
	if (pos != -1)
	{
		start = pos + 10;
		end = allCookies.indexOf(";",start);
		if (end == -1) end = allCookies.length;
		popglobal = allCookies.substring(start,end);
		popglobal = unescape(popglobal);
	}
	
	// load cookies related to current ad campaigns
	
	for (x=0;x<campaignList.length;x++)
	{
		if ((campaignList[x] == specialWord) && (!includeSpecialWord))
		{
			exists = true;
		} else {
			pos = allCookies.indexOf(campaignList[x]+"=");
			if (pos != -1)
			{
				exists = true;
			} else {
				exists = false;
			}
		}
		campaignActive[x] = !exists;
	}
	
	areThereAny = false;
	for (x=0;x<campaignList.length;x++)
	{
		if (campaignActive[x] == true)
		{
			areThereAny = true;
		}
	}
	
	if (areThereAny == false)
	{
		doPopUp = false;
	}
	
}


//
// determine which campaign to use
//
function getCampaign()
{
	// check for the presence of the "specialWord" in the url
	// to utilize a special ad campaign
	checkSpecial = thisURL.indexOf(specialWord,0);
	if (checkSpecial != -1)
	{
		useCampaign = specialWord;
	} else {
	
	// the real work begins...
	//  ... again...
	
		if (weighCampaigns)
		{
			z=-1;
			for (x=0;x<campaignList.length;x++)
			{
				if (campaignActive[x])
				{
					tempCampaign = campaignList[x];
					tempAdNum = campaignNumAds[tempCampaign];
					for (y=1;y<=tempAdNum;y++)
					{
						z++;
						campaignUseList[z] = tempCampaign;
					}
				}
			}
			
			toUse = rand(campaignUseList.length);
			useCampaign = campaignUseList[toUse-1];
		} else {

			for (x=0;x<campaignList.length;x++)
			{
				if (campaignActive[x])
				{
					campaignUseList[x] = campaignList[x];
				}
			}
			
			toUse = rand(campaignUseList.length);
			useCampaign = campaignUseList[toUse-1];
		}
		
		expire = new Date(today.getTime()+(campLen*1000));
		document.cookie = useCampaign+"=used; expires="+expire.toGMTString()+"; path=/";
	}
}


//
//  determine which ad in the campaign to use
//
function getAd()
{
	numAvail = campaignNumAds[useCampaign];
	numToUse = rand(numAvail);
	
	//
	// the following is some testing code to be sure proper ads are being selected
	// it is intended for debugging only
	//
	//alert(useCampaign+" has "+numAvail);
	//for (x=1;x<=numAvail;x++)
	//{
	//	alert("of "+numAvail+", ad #"+x+" is object#"+campaignAds[useCampaign+x].adRefNum)
	//}
	
	whichOne = campaignAds[useCampaign+numToUse].adRefNum;
	return whichOne;
}



//
//  popup an ad, if necessary
//
function popUp()
{
	// check to see if popglobal exists, if it does, cancel popup
	parseCookies();
	if (popglobal != "") doPopUp = false;
	
	// verify ok to perform popup
	if (doPopUp)
	{
		getCampaign();
		
		popToDo = getAd();
		window.open(advert[popToDo].adURL+"?campaign="+advert[popToDo].adCampaign+"&name="+advert[popToDo].adName+"&weight="+advert[popToDo].adWeight+"&url="+thisURL,advert[popToDo].adName,"height="+advert[popToDo].adHeight+",width="+advert[popToDo].adWidth+",scrollbars=no,resizeable=no");

		expire = new Date(today.getTime()+(interval*1000));
		document.cookie = "popglobal=true; expires="+expire.toGMTString()+"; path=/";

	}
}
