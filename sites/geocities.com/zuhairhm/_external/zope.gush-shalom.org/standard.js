// ---- begin class: Rollover ----

function Rollover(image_id,normal_url,mouseover_url,td_id,mouseover_fgcolor,mouseover_bgcolor) {
 this.image_id=image_id;
 this.normal_url=normal_url;
 this.mouseover_url=mouseover_url;
 this.mouseover_image=0; // preloadImages() sets it to an Image object later once it's possible to create those
 this.td_id=td_id;
 if (this.td_id) {
  this.mouseover_fgcolor=mouseover_fgcolor;
  this.mouseover_bgcolor=mouseover_bgcolor;
  // temporary values just in case we get a rogue rollOut before rollIn updates the real values
  this.orig_fgcolor='black';
  this.orig_bgcolor='white';
 }
}

function Rollover_load_mouseover_image() {
 if (document.images) {
  this.mouseover_image = new Image();
  this.mouseover_image.src=this.mouseover_url;
 }
}

Rollover.prototype.load_mouseover_image=Rollover_load_mouseover_image;
// ---- end class: Rollover ----

// rollovers[name] is a Rollover object. Use addRollover() (see below) to populate
var rollovers=new Object();

// ==== public functions ====

// == preloadImages()
//    called as body's onload (if you also need some other OnLoad code, use OnLoadHook)

var BEFORE_PRELOAD=0;
var DURING_PRELOAD=-1;
var AFTER_PRELOAD=1;

var preloadFlag = BEFORE_PRELOAD;

function onLoadHook() {
 // you can override this.
 // will be called after preload is done
}

function preloadImages() {
 if (preloadFlag!=BEFORE_PRELOAD)
  return;
 preloadFlag=DURING_PRELOAD;
 if (document.images) {
  for (name in rollovers) {
   setTimeout('rollovers["'+name+'"].load_mouseover_image()',10*Math.floor(300*Math.random()));
  }
  preloadFlag=AFTER_PRELOAD;
  onLoadHook();
 } else {
  preloadFlag=BEFORE_PRELOAD;
 }
}


// == addRollover(name,...)
//    should be called for each roll-over image[+ optional text td]. you should then use rollIn(name) and rollOut(name)
//    as OnMouseOver and OnMouseOut of both image and text container
function addRollover(name,image_id,normal_url,mouseover_url,td_id,mouseover_fgcolor,mouseover_bgcolor) {
 rollovers[name]=new Rollover(image_id,normal_url,mouseover_url,td_id,mouseover_fgcolor,mouseover_bgcolor);
}

// == rollIn(rollover_name)
//    should be the onmouseover of:
//    * an image with the id image_id
//    * a <td> element with the id td_id (if td_id was supplied to the constructor)

function rollIn(rollover_name) {
 var rollover=rollovers[rollover_name];
 if (preloadFlag==AFTER_PRELOAD) {
  document.getElementById(rollover.image_id).src=rollover.mouseover_url;
 } else {
  if (preloadFlag==BEFORE_PRELOAD) {
   setTimeout('preloadImages()',1000); // maybe we'll get lucky next time :)
  }
 };
 if (rollover.td_id) {
  // if we're at rollIn, td object probably exists by now :)
  var td=document.getElementById(rollover.td_id);
  rollover.orig_fgcolor=td.style.color;
  rollover.orig_bgcolor=td.style.bgColor;
  td.style.color=rollover.mouseover_fgcolor;
  td.style.bgColor=rollover.mouseover_bgolor;
 }
 return true;
}

// == rollOut(rollover_name) should be the onmouseout of a roll-over image
//    should be the onmouseoout of a link containing a the image tag called image_name
function rollOut(rollover_name) {
 var rollover=rollovers[rollover_name];
 if (preloadFlag==AFTER_PRELOAD) {
  document.getElementById(rollover.image_id).src=rollover.normal_url;
 } else {
  if (preloadFlag==BEFORE_PRELOAD) {
   setTimeout('preloadImages()',1000); // maybe we'll get lucky next time :)
  }
 };
 if (rollover.td_id) {
  var td=document.getElementById(rollover.td_id);
  td.style.color=rollover.orig_fgcolor;
  td.style.bgColor=rollover.orig_bgolor;
 }
 return true;
}
