function maxjukeboxlaunch()
{
  if (document.all) {
    if (document.all.maxmusic)
      document.all.maxmusic.src = '';
  }
  else if (document.embeds) {
    if (document.embeds.maxmusic)
      document.embeds.maxmusic.stop()
  }
  var win = window.open('/jukebox.html','maxjukebox','toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=yes,width=240,height=240,top=0,left=0');
  if (win && win.focus)
    win.focus();
}
