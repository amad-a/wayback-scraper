function formHandler(form)
{
var URL = document.form.site.options[document.form.site.selectedIndex].value;
window.location.href = URL;
}


document.write
(
'<select name="site" onchange="formHandler()">',
'<option selected value="#">Quick Links....</option>',
'<option value="http://www.wbur.org/schedule">&nbsp;&nbsp;On-Air Schedule</option>',
'<option value="http://www.wbur.org/inside/pledge">&nbsp;&nbsp;Pledge Your Support</option>',
'<option value="">- - - - - - - - -</option>',
'<option value="http://www.wbur.org/allshows/"><B>RADIO PROGRAMS</B></option>',
'<option value="http://www.theconnection.org">&nbsp;&nbsp;The Connection</option>',
'<option value="http://www.onpointradio.org">&nbsp;&nbsp;On Point</option>',	
'<option value="http://www.publicbroadcasting.net/wbur/news/local/">&nbsp;&nbsp;Morning Edition</option>',
'<option value="http://www.here-now.org">&nbsp;&nbsp;Here and Now</option>',
'<option value="http://www.onlyagame.org">&nbsp;&nbsp;Only a Game</option>',
'<option value="http://www.buwi.org">&nbsp;&nbsp;World of Ideas</option>',
'<option value="http://insideout.wbur.org">&nbsp;&nbsp;Inside Out</option>',
'<option value="http://www.wbur.org/archives">&nbsp;&nbsp;Show Archives</option>',
'<option value="">- - - - - - - - -</option>',
'<option value="http://www.wbur.org/inside/"><B>INSIDE WBUR</B></option>',
'<option value="http://events.publicbroadcasting.net/wbur/events.eventsmain"><B>Arts Calendar</B></option>',
'<option value="http://www.wbur.org/inside/volunteer">&nbsp;&nbsp;Volunteer</option>',
'<option value="http://www.wbur.org/inside/personality/hostdefault.asp">&nbsp;&nbsp;Show Hosts</option>',
'<option value="http://www.wbur.org/store/">&nbsp;&nbsp;WBUR Store</option>',
'<option value="http://citizens.wbur.org">&nbsp;&nbsp;Citizens of the World</option>',
'<option value="http://www.wbur.org/inside/events">&nbsp;&nbsp;WBUR Events</option>',
'<option value="http://www.wbur.org/inside/jobs">&nbsp;&nbsp;Jobs at WBUR</option>',
'<option value="http://www.wbur.org/inside/thankyoucard/">&nbsp;&nbsp;Thank You Card</option>',
'<option value="http://www.wbur.org/inside/underwriting">&nbsp;&nbsp;Underwriting</option>',
'<option value="http://www.wbur.org/sitemap">&nbsp;&nbsp;Site Map</option>',
'</select>',
''
);

