//*****************************************************************************
//
// This script is copyright (c) 2000 by Max Software Consultants, Inc.
// All rights reserved.
//
//*****************************************************************************

function maxGetVer()
{
  return parseInt(navigator.appVersion.charAt(0));
}
function maxIsValid()
{
  return true;
}
function maxIsExplorer()
{
  return navigator.appName.indexOf("Internet Explorer") >= 0;
}
function maxIsWebTV()
{
  return navigator.appName.indexOf("WebTV") >= 0;
}
function maxIsNetscape()
{
  if (maxIsWebTV())
    return false;
  return navigator.appName.indexOf("Netscape") >= 0;
}
