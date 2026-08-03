

var chip1;
var chip2;
var chip3;
var chip4;
var chip5;
var chip6;
var Hchip4=0;
var Hchip5=0;
var Hchip6=0;

//add or delete more variables, depending on how many images you're using

function pagestart()
{checkbrOK(); 
 //chip1=new Chip("chip1",60,80);
 //chip2=new Chip("chip2",60,80);
// chip3=new Chip("chip3",60,80);
 chip4=new Chip("chip4",60,180);
 chip5=new Chip("chip5",60,80);
 chip6=new Chip("chip6",60,80);
 
 //add or delete more of the above, depending on how many images you're using
 if(brOK) 
   { //movechip("chip1");
     //movechip("chip2");
     //movechip("chip3");
     movechip("chip4");
     movechip("chip5");
     movechip("chip6");

     //add or delete more of the above, depending on how many images you're using
   }
}
var brOK=false;
var mie=false;
var aver=parseInt(navigator.appVersion.substring(0,1));
var aname=navigator.appName;

function checkbrOK()
{if(aname.indexOf("Internet Explorer")!=-1)
   {if(aver>=4) brOK=navigator.javaEnabled();
    mie=true;
   }
 if(aname.indexOf("Netscape")!=-1)  
   {if(aver>=4) brOK=navigator.javaEnabled();}
}

var vmin=2;
var vmax=5;
var vr=2;
var timer1;

function Chip(chipname,width,height)
{this.named=chipname;
 this.vx=vmin+vmax*Math.random();
 this.vy=vmin+vmax*Math.random();
 this.w=width;
 this.h=height;
 this.xx=0;
 this.yy=0;
 this.timer1=null;
}

function movechip(chipname)
{
 if(brOK)
  {eval("chip="+chipname);
   if(!mie)
    {pageX=window.pageXOffset;
     pageW=window.innerWidth;
     pageY=window.pageYOffset;
     pageH=window.innerHeight;
    }
   else
    {pageX=window.document.body.scrollLeft;
     pageW=window.document.body.offsetWidth-8;
     pageY=window.document.body.scrollTop;
     pageH=window.document.body.offsetHeight;
    } 
//alert("hi")
   chip.xx=chip.xx+chip.vx;
   chip.yy=chip.yy+chip.vy;
   
   chip.vx+=vr*(Math.random()-0.5);
   chip.vy+=vr*(Math.random()-0.5);
   if(chip.vx>(vmax+vmin))  chip.vx=(vmax+vmin)*2-chip.vx;
 if(chip.vx<(-vmax-vmin)) chip.vx=(-vmax-vmin)*2-chip.vx;
   if(chip.vy>(vmax+vmin))  chip.vy=(vmax+vmin)*2-chip.vy;
   if(chip.vy<(-vmax-vmin)) chip.vy=(-vmax-vmin)*2-chip.vy;


   if(chip.xx<=pageX)
     {chip.xx=pageX;
      chip.vx=vmin+vmax*Math.random();
//alert("1")
//stopme(chipname)
     }
   if(chip.xx>=pageX+pageW-chip.w)
     {chip.xx=pageX+pageW-chip.w;
      chip.vx=-vmin-vmax*Math.random();
//alert("2")
     }
   if(chip.yy<=pageY)
     {chip.yy=pageY;
      chip.vy=vmin+vmax*Math.random();
     //alert("3")
stopme(chipname)
}
   if(chip.yy>=pageY+pageH-chip.h)
     {chip.yy=pageY+pageH-chip.h;
      chip.vy=-vmin-vmax*Math.random();
//alert("4") 
stopme(chipname)  
  }

   if(!mie)
      {eval('document.'+chip.named+'.top ='+chip.yy);
       eval('document.'+chip.named+'.left='+chip.xx);
      } 
   else
      {eval('document.all.'+chip.named+'.style.pixelLeft='+chip.xx);
       eval('document.all.'+chip.named+'.style.pixelTop ='+chip.yy); 
      }
   chip.timer1=setTimeout("movechip('"+chip.named+"')",100);
  }
}


function stopme(chipname)
{if(brOK)
  {//alert(chipname)
   eval("chip="+chipname);

   if(chip.timer1!=null)
    {

clearTimeout(chip.timer1)
}
  
if(!mie)
      {if (eval("H"+chipname)==0){eval("H"+chipname+"=1")}
else
eval("document."+chip.named+".visibility ='hidden'");
       //eval('document.'+chip.named+'.visibility='+chip.xx);
      } 
   else
      {//alert("H"+chipname)
if (eval("H"+chipname)==0){eval("H"+chipname+"=1")}
else
eval("document.all."+chip.named+".style.visibility='hidden'");
       
      }

}
}
