<html>
<head><script src="//archive.org/includes/athena.js" type="text/javascript"></script>
<script type="text/javascript">window.addEventListener('DOMContentLoaded',function(){var v=archive_analytics.values;v.service='wb';v.server_name='wwwb-app223.us.archive.org';v.server_ms=392;archive_analytics.send_pageview({});});</script>
<script type="text/javascript" src="https://web-static.archive.org/_static/js/bundle-playback.js?v=1B2M2Y8A" charset="utf-8"></script>
<script type="text/javascript" src="https://web-static.archive.org/_static/js/wombat.js?v=1B2M2Y8A" charset="utf-8"></script>
	<meta http-equiv="Content-Language" content="en-us">
	<title>Error In Setup</title>
</head>
<body>
<p><b><font face="Verdana, Sans-serif" size="2">Initialization failed</font></b></p>
<p><font face="Verdana, Sans-serif" size="2">It seems like you are missing a 
couple of steps in your setup of ConquerChat. In order to setup ConquerChat 
correctly, please make sure to follow the steps described in the included <b>README.TXT</b> 
file.</font></p>
<p><font face="Verdana, Sans-serif" size="2">This file is shown below for your 
convenience...</font></p>
<code style="font-size: 8pt;">
<br> ConquerChat README<br> Copyright (c) 2000-2001 Peter Theill, theill.com<br> <br> -----------------------------------------------------------------------------<br> Introduction<br> -----------------------------------------------------------------------------<br> This archive contains a simple ASP chat. Most other chatrooms works using the<br> Session object. This chat doesn't and  thus might be used on larger  range of<br> browsers and -settings.<br> <br> By using  all files  in this  archive, you  are actually  able to  set up and<br> customise your own chatroom on your ASP enabled web site.<br> <br> In order to  make the chat  work properly, you  will have to  add a couple of<br> lines in your  "global.asa" file. The  lines below are  also included in  the<br> downloadable package. You should  insert them in the  top of your file,  i.e.<br> not in any of the default defined Sub functions.<br><br>	<object runat="Server<br">		SCOPE=Application<br>		ID=conquerChatUsers<br>		PROGID="Scripting.Dictionary"&gt;<br>	</object><br><br>	<object runat="Server<br">		SCOPE=Application<br>		ID=conquerChatRooms<br>		PROGID="Scripting.Dictionary"&gt;<br>	</object><br><br>	<object runat="Server<br">		SCOPE=Application<br>		ID=conquerChatMessages<br>		PROGID="Scripting.Dictionary"&gt;<br>	</object><br><br> The lines above makes  it possible to store  currently logged in chat  users,<br> rooms and  messages. We  check this  object every  time we  refresh the  chat<br> window page and kick  out inactive users. If  you do not have  a 'global.asa'<br> file use the one provided with this package. You have to place it in the root<br> of your web server and not in the 'chat' directory or where you place all the<br> other files.<br> <br> Please check:<br> <br> 	http://www.theill.com/asp/conquerchat.asp<br> 	<br> for FAQ &amp; updated information about ConquerChat.<br> <br> <br> -----------------------------------------------------------------------------<br> Customize ConquerChat<br> -----------------------------------------------------------------------------<br> To make  customisation to  the name  and/or number  of rooms,  make sure  you<br> reinitialise   the   chat.   This    is   done   by   temporarily    enabling<br> INITIALIZING_CHATSYSTEM in constants.inc.<br> <br> After having  enabled this,  request the  default.asp page  and the chat will<br> remove all rooms and users and  create the new rooms you might  have selected<br> in the constants.inc file.<br> <br> If you need me  to make a customized  version of ConquerChat for  you, please<br> contact me (sales@theill.com) for details about pricing.<br> <br> <br> -----------------------------------------------------------------------------<br> Copyright<br> -----------------------------------------------------------------------------<br> You are able to modify the  source-code any way you like. All  advertisements<br> and/or banners shown in the downloaded chat may be removed before using it on<br> your own site. ConquerChat  is 100% freeware and  enables you to get  a quick<br> start setting up your own chat without any restrictions.<br> <br> <br> -----------------------------------------------------------------------------<br> Important note for Internet Information Server 5.0 users<br> -----------------------------------------------------------------------------<br> There might be a problem for users on older versions of IIS5:<br>   http://support.microsoft.com/support/kb/articles/Q271/7/87.ASP?LN=EN-US&SD;=gn&FR;=0&qry;=Application.Lock%20IIS5&rnk;=1&src;=DHCS_MSPSS_gn_SRCH&SPR;=MSALL<br> <br> <br> -----------------------------------------------------------------------------<br> Version History<br> -----------------------------------------------------------------------------<br> 09/30/2001 - Released 3.1<br>  + Added support for private messages<br>  + Added user statistics for showing log on time, last action time, number of<br>    messages typed in the chat and the users IP address.<br> <br> 06/09/2001 - Released 3.0.2.0<br>  + Added a page being displayed for the user if required variables haven't<br>    been included in global.asa file.<br> <br> 05/01/2001<br>  + Added option for clearing message field after having send a message.<br>  <br> 03/21/2001 - Released 3.0.1.0<br>  + Added a new constant "TOP_MESSAGE_ORDER" for selecting if the messages<br>    should be printed top-to-bottom or bottom-to-top.<br>  <br> 02/08/2001 - Released 3.0.0.1<br>  ! Fixed a problem when checking for invalid username in default.asp page.<br>  <br> 10/22/2000 - Released 3.0.0.0<br>  + Added support for multiple rooms<br> <br> 07/18/2000 - Released 2.1.1.0<br>  + updated code with a more safe logout method.<br>  + help files updated to show smiley states and descriptions.<br> <br> 06/29/2000 - Released 2.1.0.0<br>  + added ability to replace typed smilies with images showing state. This<br>    feature was implemented thanks to Michael Mackert.<br> <br> Best regards,<br>  Peter Theill - peter@theill.com - http://www.theill.com<br> -----------------------------------------------------------------------------<br>
</code>
</body>
</html><!--
     FILE ARCHIVED ON 19:21:56 Oct 20, 2007 AND RETRIEVED FROM THE
     INTERNET ARCHIVE ON 23:59:31 Jul 29, 2025.
     JAVASCRIPT APPENDED BY WAYBACK MACHINE, COPYRIGHT INTERNET ARCHIVE.
     ALL OTHER CONTENT MAY ALSO BE PROTECTED BY COPYRIGHT (17 U.S.C.
     SECTION 108(a)(3)).
-->
<!--
playback timings (ms):
  captures_list: 0.73
  exclusion.robots: 0.036
  exclusion.robots.policy: 0.023
  esindex: 0.013
  cdx.remote: 68.442
  LoadShardBlock: 59.932 (3)
  PetaboxLoader3.datanode: 112.914 (4)
  load_resource: 234.514
  PetaboxLoader3.resolve: 164.234
-->