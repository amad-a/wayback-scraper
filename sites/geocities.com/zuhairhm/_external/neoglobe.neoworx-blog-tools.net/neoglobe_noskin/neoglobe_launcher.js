
// Display NeoPlanet


document.write('<object data="http://neoglobe.neoworx-blog-tools.net/neoglobe_noskin/globe.swf" width="'+size+'" height="'+size+'" type="application/x-shockwave-flash">');
document.write('<param name="movie" value="http://neoglobe.neoworx-blog-tools.net/neoglobe_noskin/globe.swf" />');
if(typeof(affiliate_id) == "undefined"){
affiliate_id="";
}
document.write('<param name="FlashVars" value="affiliate_id='+affiliate_id+'&registered_id='+registered_id+'&counter_id='+counter_id+'&popup='+popup+'" />');
document.write('<param name="allowScriptAccess" value="always">');
document.write('<param name="wmode" value="transparent">');
document.write('</object>');

// Popup
function launch_large_neoglobe() 
{
  var lalargeur =  1000  ; // ici la largeur du popup
  var lahauteur = 800 ;  // ici la hauteur du popup
  var yes = 1;
  var no = 0;
  var menubar = no; //  Fichier, Editiion, Affichage...
  var scrollbars = no; // scrollbarre horizontale & verticale 
  var locationbar = no; // Barre d'adresse
  var directories = no; // Barre de liens
  var resizable = no; // Permettre la fenetre d'être redimensionné 
  var statusbar = no; // Status bar (with "Document: Done")
  var toolbar = no; // retour, Home, Stop bar d'outil
  var t = (screen.height-lahauteur)/2 ;  // pour centre selon la hauteur de l'écran
  var l = (screen.width-lalargeur)/2 ; // pour centrer selon la largeur de l'écran
  
   propriete = "width=" + (lalargeur) + ",height=" + (lahauteur) +  ",top=" + t +",left=" + l ;
   propriete += (menubar ? ",menubars" : "") + (scrollbars ? ",scrollbars" : "") + (locationbar ? ",location" : "") + (directories ? ",directories" : "") + (resizable ? ",resizable" : "") + (statusbar ? ",status" : "") + (toolbar ? ",toolbar" : "") ;

	// detect popup blocker
	var mine =   window.open("http://neoglobe.neoworx-blog-tools.net/neoglobe_large/globe.swf?counter_id="+counter_id, "NeoGlobe", propriete) ;
 	if(mine){
    	var popUpsBlocked = false;
 	} else {
    	var popUpsBlocked = true
		alert('We have detected that you are using popup blocking software.\n Please allow popups from NeoWORX to view NeoPlanet correctly.');
 	}
}
