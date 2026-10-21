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
// 12/14/2001 - wmk - created
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

function openMyBooknotes(url) {
  window.self.name = "mybooknotesWindow"
  popup = window.open(url,"MyBooknotesWindow", "width=420,height=260");
}
