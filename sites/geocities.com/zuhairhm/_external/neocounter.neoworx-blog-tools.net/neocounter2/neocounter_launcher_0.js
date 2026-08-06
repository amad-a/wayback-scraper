function setFlashWidth0(newW0){
	document.getElementById('neocounter0').style.width = newW0+"px";		
}

function setFlashHeight0(newH0){
	document.getElementById('neocounter0').style.height = newH0+"px";		
}


function setFlashSize0(newW0, newH0){
	setFlashWidth0(newW0);
	setFlashHeight0(newH0);
}

function display_map0(map, xpos, ypos){
	if(mapside!=null){xpos = mapside;}
	if(map!="none")
	{
		document.map_image0.src = "http://www.neoworx.net/maps/"+map+".jpg";
		document.map_image0.style.visibility = "visible";	
		document.getElementById('map_popup0').style.top = ypos+"px";
		if(xpos==1){
		document.getElementById('map_popup0').style.left = -20-document.map_image0.width+"px";}
		else{
		document.getElementById('map_popup0').style.left = 50+"px";}
	}
	else
	{
		document.map_image0.style.visibility = "hidden";	
	}
}

document.write('<object data="http://neocounter.neoworx-blog-tools.net/neocounter2/neocounter3.swf" width="100%" height="100%" type="application/x-shockwave-flash">');
document.write('<param name="movie" value="http://neocounter.neoworx-blog-tools.net/neocounter2/neocounter3.swf" />');
if(typeof(affiliate_id) == "undefined"){
affiliate_id="";
}
document.write('<param name="FlashVars" value="affiliate_id='+affiliate_id+'&counter_id='+counter_id+'&display_type='+display_type+'&skin='+skin+'&autoresize='+autoresize+'" />');
document.write('<param name="allowScriptAccess" value="always">');
document.write('<param name="wmode" value="transparent">');
document.write('</object>');

