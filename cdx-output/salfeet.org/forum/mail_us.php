<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html dir="rtl"><head>






<!-- End Wayback Rewrite JS Include -->


<meta http-equiv="Content-Style-Type" content="text/css">

<link rel="top" href="./index.php?sid=3868f863a842457fe9598db5fa688b4d" title="yourdomain.com قائمة المنتديات">
<link rel="search" href="./search.php?sid=3868f863a842457fe9598db5fa688b4d" title="ابحـث">
<link rel="help" href="./faq.php?sid=3868f863a842457fe9598db5fa688b4d" title="س و ج">
<link rel="author" href="./memberlist.php?sid=3868f863a842457fe9598db5fa688b4d" title="قائمة الاعضاء">

<title>yourdomain.com :: </title>
<link rel="stylesheet" href="http://www.salfeet.org/forum/templates/subSilver/subSilver.css" type="text/css">
<!--style type="text/css">
<!--
/*
  The original subSilver Theme for phpBB version 2+
  Created by subBlue design
  http://www.subBlue.com

  NOTE: These CSS definitions are stored within the main page body so that you can use the phpBB2
  theme administration centre. When you have finalised your style you could cut the final CSS code
  and place it in an external file, deleting this section to save bandwidth.
*/

/* General page style. The scroll bar colours only visible in IE5.5+ */
body {
	background-color: #FFFFFF;
	scrollbar-face-color: #DEE3E7;
	scrollbar-highlight-color: #FFFFFF;
	scrollbar-shadow-color: #DEE3E7;
	scrollbar-3dlight-color: #D1D7DC;
	scrollbar-arrow-color:  #006699;
	scrollbar-track-color: #EFEFEF;
	scrollbar-darkshadow-color: #98AAB1;
}

/* General font families for common tags */
font,th,td,p { font-family: Tahoma, Verdana, Arial, Helvetica, sans-serif }
a:link,a:active,a:visited { color : #006699; }
a:hover		{ text-decoration: underline; color : #DD6900; }
hr	{ height: 0px; border: solid #D1D7DC 0px; border-top-width: 1px;}

/* This is the border line & background colour round the entire page */
.bodyline	{ background-color: #FFFFFF; border: 1px #98AAB1 solid; }

/* This is the outline round the main forum tables */
.forumline	{ background-color: #FFFFFF; border: 2px #006699 solid; }

/* Main table cell colours and backgrounds */
td.row1	{ background-color: #EFEFEF; }
td.row2	{ background-color: #DEE3E7; }
td.row3	{ background-color: #D1D7DC; }

/*
  This is for the table cell above the Topics, Post & Last posts on the index.php page
  By default this is the fading out gradiated silver background.
  However, you could replace this with a bitmap specific for each forum
*/
td.rowpic {
		background-color: #FFFFFF;
		background-image: url(templates/subSilver/images/cellpic2.jpg);
		background-repeat: repeat-y;
}

/* Header cells - the blue and silver gradient backgrounds */
th	{
	color: #FFA34F; font-size: 11px; font-weight : bold;
	background-color: #006699; height: 25px;
	background-image: url(templates/subSilver/images/cellpic3.gif);
}

td.cat,td.catHead,td.catSides,td.catLeft,td.catRight,td.catBottom {
			background-image: url(templates/subSilver/images/cellpic1.gif);
			background-color:#D1D7DC; border: #FFFFFF; border-style: solid; height: 28px;
}

/*
  Setting additional nice inner borders for the main table cells.
  The names indicate which sides the border will be on.
  Don't worry if you don't understand this, just ignore it :-)
*/
td.cat,td.catHead,td.catBottom {
	height: 29px;
	border-width: 0px 0px 0px 0px;
}
th.thHead,th.thSides,th.thTop,th.thLeft,th.thRight,th.thBottom,th.thCornerL,th.thCornerR {
	font-weight: bold; border: #FFFFFF; border-style: solid; height: 28px;
}
td.row3Right,td.spaceRow {
	background-color: #D1D7DC; border: #FFFFFF; border-style: solid;
}

th.thHead,td.catHead { font-size: 12px; border-width: 1px 1px 0px 1px; }
th.thSides,td.catSides,td.spaceRow	 { border-width: 0px 1px 0px 1px; }
th.thRight,td.catRight,td.row3Right	 { border-width: 0px 1px 0px 0px; }
th.thLeft,td.catLeft	  { border-width: 0px 0px 0px 1px; }
th.thBottom,td.catBottom  { border-width: 0px 1px 1px 1px; }
th.thTop	 { border-width: 1px 0px 0px 0px; }
th.thCornerL { border-width: 1px 0px 0px 1px; }
th.thCornerR { border-width: 1px 1px 0px 0px; }

/* The largest text used in the index page title and toptic title etc. */
.maintitle	{
	font-weight: bold; font-size: 22px; font-family: "Tahoma, Trebuchet MS",Tahoma, Verdana, Arial, Helvetica, sans-serif;
	text-decoration: none; line-height : 120%; color : #000000;
}

/* General text */
.gen { font-size : 12px; }
.genmed { font-size : 11px; }
.gensmall { font-size : 10px; }
.gen,.genmed,.gensmall { color : #000000; }
a.gen,a.genmed,a.gensmall { color: #006699; text-decoration: none; }
a.gen:hover,a.genmed:hover,a.gensmall:hover	{ color: #DD6900; text-decoration: underline; }

/* The register, login, search etc links at the top of the page */
.mainmenu		{ font-size : 11px; color : #000000 }
a.mainmenu		{ text-decoration: none; color : #006699;  }
a.mainmenu:hover{ text-decoration: underline; color : #DD6900; }

/* Forum category titles */
.cattitle		{ font-weight: bold; font-size: 12px ; letter-spacing: 1px; color : #006699}
a.cattitle		{ text-decoration: none; color : #006699; }
a.cattitle:hover{ text-decoration: underline; }

/* Forum title: Text and link to the forums used in: index.php */
.forumlink		{ font-weight: bold; font-size: 12px; color : #006699; }
a.forumlink 	{ text-decoration: none; color : #006699; }
a.forumlink:hover{ text-decoration: underline; color : #DD6900; }

/* Used for the navigation text, (Page 1,2,3 etc) and the navigation bar when in a forum */
.nav			{ font-weight: bold; font-size: 11px; color : #000000;}
a.nav			{ text-decoration: none; color : #006699; }
a.nav:hover		{ text-decoration: underline; }

/* titles for the topics: could specify viewed link colour too */
.topictitle,h1,h2	{ font-weight: bold; font-size: 11px; color : #000000; }
a.topictitle:link   { text-decoration: none; color : #006699; }
a.topictitle:visited { text-decoration: none; color : #5493B4; }
a.topictitle:hover	{ text-decoration: underline; color : #DD6900; }

/* Name of poster in viewmsg.php and viewtopic.php and other places */
.name			{ font-size : 11px; color : #000000;}

/* Location, number of posts, post date etc */
.postdetails		{ font-size : 10px; color : #000000; }

/* The content of the posts (body of text) */
.postbody { font-size : 12px; line-height: 18px}
a.postlink:link	{ text-decoration: none; color : #006699 }
a.postlink:visited { text-decoration: none; color : #5493B4; }
a.postlink:hover { text-decoration: underline; color : #DD6900}

/* Quote & Code blocks */
.code {
	font-family: Tahoma, Courier, 'Courier New', sans-serif; font-size: 11px; color: #006600;
	background-color: #FAFAFA; border: #D1D7DC; border-style: solid;
	border-left-width: 1px; border-top-width: 1px; border-right-width: 1px; border-bottom-width: 1px
}

.quote {
	font-family: Tahoma, Verdana, Arial, Helvetica, sans-serif; font-size: 11px; color: #444444; line-height: 125%;
	background-color: #FAFAFA; border: #D1D7DC; border-style: solid;
	border-left-width: 1px; border-top-width: 1px; border-right-width: 1px; border-bottom-width: 1px
}

/* Copyright and bottom info */
.copyright		{ font-size: 10px; font-family: Tahoma, Verdana, Arial, Helvetica, sans-serif; color: #444444; letter-spacing: -1px;}
a.copyright		{ color: #444444; text-decoration: none;}
a.copyright:hover { color: #000000; text-decoration: underline;}

/* Form elements */
input,textarea, select {
	color : #000000;
	font: normal 11px Tahoma, Verdana, Arial, Helvetica, sans-serif;
	border-color : #000000;
}

/* The text input fields background colour */
input.post, textarea.post, select {
	background-color : #FFFFFF;
}

input { text-indent : 2px; }

/* The buttons used for bbCode styling in message post */
input.button {
	background-color : #EFEFEF;
	color : #000000;
	font-size: 11px; font-family: Tahoma, Verdana, Arial, Helvetica, sans-serif;
}

/* The main submit button option */
input.mainoption {
	background-color : #FAFAFA;
	font-weight : bold;
}

/* None-bold submit button */
input.liteoption {
	background-color : #FAFAFA;
	font-weight : normal;
}

/* This is the line in the posting page which shows the rollover
  help line. This is actually a text box, but if set to be the same
  colour as the background no one will know ;)
*/
.helpline { background-color: #DEE3E7; border-style: none; }

/* Import the fancy styles for IE only (NS4.x doesn't use the @import function) */
@import url("templates/subSilver/formIE.css");
-->
<!--/style-->
<script language="JavaScript">
<!--
function MM_jumpMenu(targ,selObj,restore){ //v3.0
  eval(targ+".location='"+selObj.options[selObj.selectedIndex].value+"'");
  if (restore) selObj.selectedIndex=0;
}
//-->
</script>
<script language="JavaScript">
<!--
function mpFoto(img){
foto1= new Image();
foto1.src=(img);
mpControl(img);
}
function mpControl(img){
if((foto1.width!=0)&&(foto1.height!=0)){
viewFoto(img);
}
else{
mpFunc="mpControl('"+img+"')";
intervallo=setTimeout(mpFunc,20);
}
}
function viewFoto(img){
largh=foto1.width+20;
altez=foto1.height+20;
string="width="+largh+",height="+altez;
finestra=;
}
//-->
</script>
<script language="Javascript" type="text/javascript">
<!--
function setCheckboxes(theForm, elementName, isChecked)
{
    var chkboxes = document.forms[theForm].elements[elementName];
    var count = chkboxes.length;

    if (count)
	{
        for (var i = 0; i < count; i++)
		{
            chkboxes[i].checked = isChecked;
    	}
    }
	else
	{
    	chkboxes.checked = isChecked;
    }

    return true;
}
//-->
</script>
<script language="JavaScript1.2">
<!--

var ns6=document.getElementById&&!document.all?1:0

var head="display:''"
var folder=''

function expandit(curobj){
folder=ns6?curobj.nextSibling.nextSibling.style:document.all[curobj.sourceIndex+1].style
if (folder.display=="none")
folder.display=""
else
folder.display="none"
}

//-->
</script>
</head>
<body bgcolor="#FFFFFF" text="#000000" link="#006699" vlink="#5493B4">

<a name="top"></a>

<table width="100%" cellspacing="0" cellpadding="10" border="0" align="center">
	<tbody><tr>
		<td><table width="100%" cellspacing="0" cellpadding="0" border="0">
			<tbody><tr>
				<td><a href="portal.php?sid=3868f863a842457fe9598db5fa688b4d"><img src="http://www.salfeet.org/forum/templates/subSilver/images/logo_phpBB.gif" border="0" alt="yourdomain.com قائمة المنتديات" vspace="1"></a></td>
				<td align="center" width="100%" valign="middle"><span class="maintitle">yourdomain.com</span><br><span class="gen">A _little_ text to describe your forum<br>&nbsp; </span>
				<table cellspacing="0" cellpadding="2" border="0">
					<tbody><tr>
						<td align="center" valign="top" nowrap="nowrap"><span class="mainmenu">&nbsp;<a href="portal.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_message.gif" width="12" height="13" border="0" alt="الصفحة الرئيسية" hspace="3">الصفحة الرئيسية</a>&nbsp;&nbsp;&nbsp;<a href="index.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_members.gif" width="12" height="13" border="0" alt="yourdomain.com قائمة المنتديات" hspace="3">قائمة المنتديات</a>&nbsp;&nbsp;&nbsp;<a href="faq.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_faq.gif" width="12" height="13" border="0" alt="س و ج" hspace="3">س و ج</a></span><span class="mainmenu">&nbsp; &nbsp;<a href="search.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_search.gif" width="12" height="13" border="0" alt="ابحـث" hspace="3">ابحـث</a>&nbsp; &nbsp;<a href="memberlist.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_members.gif" width="12" height="13" border="0" alt="قائمة الاعضاء" hspace="3">قائمة الاعضاء</a>&nbsp; &nbsp;<a href="groupcp.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_groups.gif" width="12" height="13" border="0" alt="المجموعات" hspace="3">المجموعات</a>&nbsp;
						</span></td>
					</tr>
					<tr>
						<td height="35" align="center" valign="top" nowrap="nowrap"><span class="mainmenu">&nbsp;<a href="profile.php?mode=editprofile&amp;sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_profile.gif" width="12" height="13" border="0" alt="الملف الشخصي" hspace="3">الملف الشخصي</a>&nbsp; &nbsp;<a href="privmsg.php?folder=inbox&amp;sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_message.gif" width="12" height="13" border="0" alt="ادخل لقراءة رسائلك الخاصة" hspace="3">ادخل لقراءة رسائلك الخاصة</a>&nbsp; &nbsp;<a href="login.php?sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_login.gif" width="12" height="13" border="0" alt="دخول" hspace="3">دخول</a>&nbsp;</span>
						&nbsp;<a href="profile.php?mode=register&amp;sid=3868f863a842457fe9598db5fa688b4d" class="mainmenu"><img src="http://www.salfeet.org/forum/templates/subSilver/images/icon_mini_register.gif" width="12" height="13" border="0" alt="سجل معنا" hspace="3">سجل معنا</a>&nbsp;
                        </td>
					</tr>
				</tbody></table></td>
			</tr>
		</tbody></table>
		<br>
<center>
<table border="0" width="80%" cellspacing="1" cellpadding="2" class="forumline">
  <tbody><tr>
	<th colspan="3" class="thCornerL" height="25" nowrap="nowrap">&nbsp;All Pages&nbsp;</th>
  </tr>
  <tr>
	<td width="10%" align="center" class="row1"><img src="http://www.salfeet.org/forum/images/default.gif" border="0"></td>
	<td class="row1" align="center"><span class="gen">This message will be shown on all pages. It can be view by all visitors. The width of the table = 80%. It als display a gif file. Order 10</span></td>
	<td width="10%" align="center" class="row1"><img src="http://www.salfeet.org/forum/images/default.gif" border="0"></td>
  </tr>

</tbody></table>
<table border="0" width="80%">
  <tbody><tr>
	<td align="left" valign="top"><span class="gensmall"><a href="index.php?bm=&amp;sid=3868f863a842457fe9598db5fa688b4d" title="" class="nav"></a></span></td>
	<td align="right" valign="top"><span class="gensmall"><a href="index.php?bm=&amp;sid=3868f863a842457fe9598db5fa688b4d" title="" class="nav"></a></span></td>
  </tr>

</tbody></table>
</center>


		<br>
<script>
<!--
// Email Validation. Written by PerlScriptsJavaScripts.com

function check_email(e) {
ok = "1234567890qwertyuiop[]asdfghjklzxcvbnm.@-_QWERTYUIOPASDFGHJKLZXCVBNM";

for(i=0; i < e.length ;i++){
if(ok.indexOf(e.charAt(i))<0){
return (false);
}
}

if (document.images) {
re = /(@.*@)|(\.\.)|(^\.)|(^@)|(@$)|(\.$)|(@\.)/;
re_two = /^.+\@(\[?)[a-zA-Z0-9\-\.]+\.([a-zA-Z]{2,4}|[0-9]{1,3})(\]?)$/;
if (!e.match(re) && e.match(re_two)) {
return (-1);
}
}
}
// -->
</script>

<script>
<!--
function check_form(f) { // f is the form (passed using the this keyword)
if(f.name.value.length < 2){
alert("يجب عليك كتابة الإسم أولاً.");
f.name.focus(); // put the prompt in the name field
// make sure the form is not submitted
return false;
}

// check the email address ( the exclamation means "not" )
if(!check_email(f.email.value)){
alert("لم تقم بإدخال بريدك الإلكتروني أو أن البريد الذي أدخلته غير صحيح.");
f.email.focus();
// make sure the form is not submitted
return false;
}

// check the Comments ( the exclamation means "not" )
if(f.Comments.value.length < 10){
alert("لم تقم بكتابة الرسالة أو أن الرسالة التي كتبتها قصيرة جداً.");
f.Comments.focus();
// make sure the form is not submitted
return false;
}
}

// -->
</script>

<table width="100%" cellspacing="0" cellpadding="2" border="0" align="center">
  <tbody><tr>
	<td valign="bottom"><span class="gensmall">
     <span class="nav"><a href="index.php?sid=3868f863a842457fe9598db5fa688b4d" class="nav">yourdomain.com قائمة المنتديات</a></span></span></td>
	<td align="right" valign="bottom" class="gensmall">
  </td></tr>
</tbody></table>
<table width="100%" class="forumline" cellspacing="1" cellpadding="0" border="0" align="center">
  <tbody><tr>
    <td class="catLeft" valign="center"><center><span class="cattitle">نموذج المراسلة</span></center></td>
  </tr>
  <tr>
    <td class="row1">
      <form action="mail_us.php" method="post" onsubmit="return check_form(this)">
        <table width="100%">
          <tbody><tr>
            <td align="center"><span class="gen">الإسم:</span>&nbsp;<input name="name" size="30" value=""></td>
          </tr>
          <tr>
            <td align="center"><span class="gen">البريد:</span>&nbsp;&nbsp;<input name="email" size="30" value=""></td>
          </tr>
          <tr>
           <td align="center"><span class="gen">رسالتك:</span><br>
           <textarea name="Comments" cols="55" rows="10" wrap="soft"></textarea></td>
          </tr>
          <tr>
            <td align="center"><br><input type="submit" class="mainoption" value="ارسل الرسالة">&nbsp;&nbsp;<input type="reset" class="mainoption" value="مسح الحقول"></td>
          </tr>
        </tbody></table>
      </form>
    </td>
  </tr>
</tbody></table>


<div align="center"><span class="copyright"><br><br>
<!--
	We request you retain the full copyright notice below including the link to www.phpbb.com.
	This not only gives respect to the large amount of time given freely by the developers
	but also helps build interest, traffic and use of phpBB 2.0. If you cannot (for good
	reason) retain the full copyright we request you at least leave in place the
	Powered by phpBB 2.0.4 line, with phpBB linked to www.phpbb.com. If you refuse
	to include even this then support on our forums may be affected.

	The phpBB Group : 2002
// -->
</span><span class="genmed"><b><a href="dload.php?sid=3868f863a842457fe9598db5fa688b4d">مكتبة الملفات</a>  ::  <a href="links.php?sid=3868f863a842457fe9598db5fa688b4d">دليل المواقع</a>  ::  <a href="album.php?sid=3868f863a842457fe9598db5fa688b4d">مكتبة الصور</a>  ::  <a href="calendar.php?sid=3868f863a842457fe9598db5fa688b4d">التقويم</a>
  &nbsp;</b>
</span></div>
<div align="center"><span class="genmed"><b>
Powered by <a href="http://www.phpbb.com/" target="_phpbb">phpBB</a> 2.0.4 © 2001, 2002 phpBB Group<br>
Design by : <a href="mailto:hyper_beem86@hotmail.com"> Mahmood Madi</a>
</b></span></div><b>

<!--
     FILE ARCHIVED ON 05:06:18 Sep 05, 2004 AND RETRIEVED FROM THE
     INTERNET ARCHIVE ON 00:27:27 Feb 27, 2026.
     JAVASCRIPT APPENDED BY WAYBACK MACHINE, COPYRIGHT INTERNET ARCHIVE.

     ALL OTHER CONTENT MAY ALSO BE PROTECTED BY COPYRIGHT (17 U.S.C.
     SECTION 108(a)(3)).
-->
<!--
playback timings (ms):
  captures_list: 1.803
  exclusion.robots: 0.038
  exclusion.robots.policy: 0.026
  esindex: 0.009
  cdx.remote: 14.939
  LoadShardBlock: 74.068 (3)
  PetaboxLoader3.datanode: 107.27 (4)
  load_resource: 136.521
  PetaboxLoader3.resolve: 75.785
--></b></td></tr></tbody></table></body><!-- https://web.archive.org/web/20040905050618if_/http://www.salfeet.org:80/forum/mail_us.php -->
</html>