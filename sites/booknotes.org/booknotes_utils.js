//
// booknotes_utils.js -- Client-side Javascript utilities
//
// Description:
//
// Author: WM Kules, Takoma Softare, Inc.
// 
// Copyright 2001, National Cable Satellite Corporation 
// 
// Modification history:
// 10/31/2001 - wmk - created
//

//
// openPlayer() -- Opens a new window for the video player
//
// Actually it doesn't open a new window -- it just names the
// existing window so Virage can return to it later.
//
// Argument: strURL -- URL for new window
//
// Returns: nothing
//
// Side effects: Names the current window 'parentWindow'
// so that the video player can return control to it.
//
function openPlayer(strURL) {
//  alert ("opening URL:" + strURL + ":");
  window.self.name = "parentWindow"
  popup = window.open(strURL,"videoHubWindow", "width=550,height=450,scrollbars=1");
}

//
// isValidAdvSearchForm() -- Validates advanced search form
//
// Performs the following validation:
// If users enter query text, they must check at least one
// field to search in.
//
// Argument: form -- the form being validated
//
// Returns:
//   true -- if form is valid
//   false -- if not
//
// Side effects: Pops an alert box with error message.
//
function isValidAdvSearchForm(form) {
//  alert ("validating form" + form.SearchFields[0].checked);
  if ((form.QueryText.value != "") && (!form.SearchFields[0].checked) &&
      (!form.SearchFields[1].checked) && (!form.SearchFields[2].checked)) {
    alert("Please select the fields to search for your text\n" +
          "(" + form.QueryText.value + ")");
    form.SearchFields[0].focus();
    return false;
  }
}

