function setFlashWidth4(newW4){
	document.getElementById('neocounter4').style.width = newW4+"px";		
}

function setFlashHeight4(newH4){
	document.getElementById('neocounter4').style.height = newH4+"px";		
}


function setFlashSize4(newW4, newH4){
	setFlashWidth4(newW4);
	setFlashHeight4(newH4);
}

function display_map4(map, xpos, ypos){
	if(mapside!=null){xpos = mapside;}
	if(map!="none")
	{
		document.map_image4.src = "http://www.neoworx.net/maps/"+map+".jpg";
		document.map_image4.style.visibility = "visible";	
		document.getElementById('map_popup4').style.top = ypos+"px";
		if(xpos==1){
		document.getElementById('map_popup4').style.left = -20-document.map_image4.width+"px";}
		else{
		document.getElementById('map_popup4').style.left = 50+"px";}
	}
	else
	{
		document.map_image4.style.visibility = "hidden";	
	}
}

function getCookie(name)
{
    var dc = document.cookie;
    var prefix = name + "=";
    var begin = dc.indexOf("; " + prefix);
    if (begin == -1)
    {
        begin = dc.indexOf(prefix);
        if (begin != 0) return null;
    }
    else
    {
        begin += 2;
    }
    var end = document.cookie.indexOf(";", begin);
    if (end == -1)
    {
        end = dc.length;
    }
    return unescape(dc.substring(begin + prefix.length, end));
}

expire = getCookie('9372255674');
status = getCookie('8889135618');

var lang = "en";
var lang = (navigator.language) ? navigator.language : navigator.userLanguage;

document.write('<object data="http://neocounter.neoworx-blog-tools.net/neocounter2/neocounter3_v6.swf" width="100%" height="100%" type="application/x-shockwave-flash">');
document.write('<param name="movie" value="http://neocounter.neoworx-blog-tools.net/neocounter2/neocounter3_v6.swf" />');
if(typeof(affiliate_id) == "undefined"){
affiliate_id="";
}
document.write('<param name="FlashVars" value="affiliate_id='+affiliate_id+'&counter_id='+counter_id+'&display_type='+display_type+'&skin='+skin+'&autoresize='+autoresize+'&expire='+expire+'&status='+status+'&lang='+lang+'" />');
document.write('<param name="allowScriptAccess" value="always">');
document.write('<param name="wmode" value="transparent">');
document.write('</object>');

