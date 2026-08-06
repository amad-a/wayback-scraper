/****************************************************************************
*                                                                           *
*                                                                           *
*            Copyright © CALCULATORCAT.COM - All Rights Reserved            *
*                                                                           *
*                                                                           *
*         This program (current moon module) is NOT public domain.          *
*      All programming and module files are owned by CalculatorCat.com.     *
*       You may not copy, modify or distribute this program or scripts      *
*           in any way except as authorized by CalculatorCat.com            *
*                                                                           *
*                                                                           *
*                  Please respect this legal copyright and                  *
*                      close this file now. Thank you!                      *
*                                                                           *
*                                                                           *
*        Questions or comments? Do you want to put this moon module         *
*               on your website? Visit www.CalculatorCat.com                *
*                                                                           *
****************************************************************************/

var data="";if(!ccm_cfg.pth) { ccm_cfg.pth="http://www.moonmodule.com/cs"; }data+='<a href="http://www.calculatorcat.com/moon_phases/phasenow.php?tcv=28" target="cc_moon_ph">';data+='<img src="'+ccm_cfg.pth+'/i/m/m'+mimg+'.gif" width="100" height="100" border="0"></a>';if(ccm_cfg.n) { data+='<br />'+phD(ph_p)+''; }if(ccm_cfg.pof) { data+='<br />'+rnd(p_o_f,0)+'% of Full'; }if(ccm_cfg.dt) { data+='<br />'+aDW[tdy.getDay()]+' '+tdy.getDate()+' '+aM2[tdy.getMonth()]+', '+tdy.getFullYear()+''; }document.write(data);