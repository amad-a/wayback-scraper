<html><head>






<!-- End Wayback Rewrite JS Include -->

<meta http-equiv="Content-Language" content="en-us">

<title>Guestbook</title>

<meta name="description" content="View/Sign our guesbook...">




<script language="JavaScript">
<!-- Hide from older browsers...

//Function to check form is filled in correctly before submitting
function CheckForm () {

	//Intialise variables
	var errorMsg = "";
	var errorMsgLong = "";

	//Check for a name
	if (document.frmSignGusetbook.name.value == ""){
		errorMsg += "\n\tName \t\t- Enter your Name";
	}
	
	//Check for a country
	if (document.frmSignGusetbook.country.value == ""){
		errorMsg += "\n\tCountry \t\t- Select the country you are in";
	}
	
	//Check for comments
	if (document.frmSignGusetbook.comments.value == ""){
		errorMsg += "\n\tComments \t- Enter a comment to add to the Guestbook";
	}
	
	//Check the description length before submiting the form	
	if (document.frmSignGusetbook.comments.value.length >= 300){
		errorMsgLong += "\n- Your comments are " + document.frmSignGusetbook.comments.value.length + " chracters long, they need to be shortned to below 150 chracters.";
	}	
	
	
	//Check for HTML tags before submitting the form	
	for (var count = 0; count <= 7; ++count){
		if ((document.frmSignGusetbook.elements[count].value.indexOf("<", 0) >= 0) && (document.frmSignGusetbook.elements[count].value.indexOf(">", 0) >= 0)){
			errorMsgLong += "\n- HTML tags are not permitted, remove all HTML tags.";
		}			
	}
	
	//If there is aproblem with the form then display an error
	if ((errorMsg != "") || (errorMsgLong != "")){
		msg = "___________________________________________________________________\n\n";
		msg += "Your Comments have not been added because there are problem(s) with the form.\n";
		msg += "Please correct the problem(s) and re-submit the form.\n";
		msg += "___________________________________________________________________\n\n";
		msg += "The following field(s) need to be corrected: -\n";
		
		errorMsg += alert(msg + errorMsg + "\n" + errorMsgLong);
		return false;
	}
	
	return true;
}

// Function to add the code for bold italic and underline, to the message
function AddMessageCode(code,promptText, InsertText) {

	if (code != "") {
		insertCode = prompt(promptText + "\n[" + code + "]xxx[/" + code + "]", InsertText);
			if ((insertCode != null) && (insertCode != "")){
				document.frmSignGusetbook.comments.value += "[" + code + "]" + insertCode + "[/"+ code + "] ";
			}
	}		
	document.frmSignGusetbook.comments.focus();
}


//Function to add the code to the message for the smileys
function AddSmileyIcon(iconCode) {	
		document.frmSignGusetbook.comments.value += iconCode + " ";
		document.frmSignGusetbook.comments.focus();
}
// -->
</script>









</head>
<body>
                


<div align="left"><b><font face="Tahoma"> 
  <font size="2">

  <a target="_self" href="default.asp?PagePosition=">Return to the the Guestbook</a></font><font size="2" color="#000000"><br>
&nbsp;</font></font></b></div>
<form method="post" name="frmSignGusetbook" action="add_comments.asp?PagePosition=" onsubmit="return CheckForm();">
  <div align="center">
    <center>
  <table width="90%" border="0" cellspacing="0" cellpadding="0" bgcolor="#cccccc" style="border-collapse: collapse" bordercolor="#999999">
    <tbody><tr>
      <td width="58%"> 
        <table width="100%" border="0" cellspacing="0" cellpadding="1" align="center">
          <tbody><tr> 
            <td height="280"> 
              <div align="center">
                <center> 
              <table width="446" border="0" class="normal" height="233" cellpadding="2" cellspacing="0" bgcolor="#cccccc" style="border-collapse: collapse" bordercolor="#999999">
                <tbody><tr align="left"> 
                  <td colspan="2" class="arial_sm2" height="30" width="442"><b>
                  <font size="2" face="Tahoma" color="#000000">*Indicates required 
                    fields</font></b></td>
                </tr>
                <tr class="arial"> 
                  <td align="right" width="80" height="14" class="arial">
                  <p align="left"><b>
                  <font size="2" face="Tahoma" color="#000000">Name*: </font></b> 
                  </p></td>
                  <td height="14" width="358"> 
                    <font face="Tahoma" color="#000000"><b> 
                    <input type="text" name="name" size="30" maxlength="30"></b></font><b><font size="2" face="Tahoma" color="#000000">
                    </font></b>
                  </td>
                </tr>
                <tr class="arial"> 
                  <td align="right" width="80" class="arial" height="12">
                  <p align="left"><b>
                  <font size="2" face="Tahoma" color="#000000">Country*:</font></b></p></td>
                  <td height="12" width="358"> 
                    <font face="Tahoma" color="#000000"><b> 
                    <select name="country">
                      <option value="" selected="">Pull down to select</option>
                      <option value="United Kingdom">United Kingdom</option>
                      <option value="United States">United States</option>
                      <option value="Afghanistan">Afghanistan</option>
                      <option value="Albania">Albania</option>
                      <option value="Algeria">Algeria</option>
                      <option value="American Samoa">American Samoa</option>
                      <option value="Andorra">Andorra</option>
                      <option value="Angola">Angola</option>
                      <option value="Anguilla">Anguilla</option>
                      <option value="Antarctica">Antarctica</option>
                      <option value="Antigua And Barbuda">Antigua And Barbuda</option>
                      <option value="Argentina">Argentina</option>
                      <option value="Armenia">Armenia</option>
                      <option value="Aruba">Aruba</option>
                      <option value="Australia">Australia</option>
                      <option value="Austria">Austria</option>
                      <option value="Azerbaijan">Azerbaijan</option>
                      <option value="Bahamas">Bahamas</option>
                      <option value="Bahrain">Bahrain</option>
                      <option value="Bangladesh">Bangladesh</option>
                      <option value="Barbados">Barbados</option>
                      <option value="Belarus">Belarus</option>
                      <option value="Belgium">Belgium</option>
                      <option value="Belize">Belize</option>
                      <option value="Benin">Benin</option>
                      <option value="Bermuda">Bermuda</option>
                      <option value="Bhutan">Bhutan</option>
                      <option value="Bolivia">Bolivia</option>
                      <option value="Bosnia Hercegovina">Bosnia Hercegovina</option>
                      <option value="Botswana">Botswana</option>
                      <option value="Bouvet Island">Bouvet Island</option>
                      <option value="Brazil">Brazil</option>
                      <option value="Brunei Darussalam">Brunei Darussalam</option>
                      <option value="Bulgaria">Bulgaria</option>
                      <option value="Burkina">Burkina Faso</option>
                      <option value="Burundi">Burundi</option>
                      <option value="Byelorussian SSR">Byelorussian SSR</option>
                      <option value="Cambodia">Cambodia</option>
                      <option value="Cameroon">Cameroon</option>
                      <option value="Canada">Canada</option>
                      <option value="Cape Verde">Cape Verde</option>
                      <option value="Cayman Islands">Cayman Islands</option>
                      <option value="Central African Republic">Central African 
                      Republic</option>
                      <option value="Chad">Chad</option>
                      <option value="Chile">Chile</option>
                      <option value="China">China</option>
                      <option value="Christmas Island">Christmas Island</option>
                      <option value="Cocos (Keeling) Islands">Cocos (Keeling) 
                      Islands</option>
                      <option value="Colombia">Colombia</option>
                      <option value="Comoros">Comoros</option>
                      <option value="Congo">Congo</option>
                      <option value="Cook Islands">Cook Islands</option>
                      <option value="Costa Rica">Costa Rica</option>
                      <option value="Cote D'Ivoire">Cote D'Ivoire</option>
                      <option value="Croatia">Croatia</option>
                      <option value="Cuba">Cuba</option>
                      <option value="Cyprus">Cyprus</option>
                      <option value="Czech Republic">Czech Republic</option>
                      <option value="Czechoslovakia">Czechoslovakia</option>
                      <option value="Denmark">Denmark</option>
                      <option value="Djibouti">Djibouti</option>
                      <option value="Dominica">Dominica</option>
                      <option value="Dominican Republic">Dominican Republic</option>
                      <option value="East Timor">East Timor</option>
                      <option value="Ecuador">Ecuador</option>
                      <option value="Egypt">Egypt</option>
                      <option value="El Salvador">El Salvador</option>
                      <option value="England">England</option>
                      <option value="Equatorial Guinea">Equatorial Guinea</option>
                      <option value="Eritrea">Eritrea</option>
                      <option value="Estonia">Estonia</option>
                      <option value="Ethiopia">Ethiopia</option>
                      <option value="Falkland Islands">Falkland Islands</option>
                      <option value="Faroe Islands">Faroe Islands</option>
                      <option value="Fiji">Fiji</option>
                      <option value="Finland">Finland</option>
                      <option value="France">France</option>
                      <option value="Gabon">Gabon</option>
                      <option value="Gambia">Gambia</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Germany">Germany</option>
                      <option value="Ghana">Ghana</option>
                      <option value="Gibraltar">Gibraltar</option>
                      <option value="Great Britain">Great Britain</option>
                      <option value="Greece">Greece</option>
                      <option value="Greenland">Greenland</option>
                      <option value="Grenada">Grenada</option>
                      <option value="Guadeloupe">Guadeloupe</option>
                      <option value="Guam">Guam</option>
                      <option value="Guatemela">Guatemela</option>
                      <option value="Guernsey">Guernsey</option>
                      <option value="Guiana">Guiana</option>
                      <option value="Guinea">Guinea</option>
                      <option value="Guinea-Bissau">Guinea-Bissau</option>
                      <option value="Guyana">Guyana</option>
                      <option value="Haiti">Haiti</option>
                      <option value="Heard Islands">Heard Islands</option>
                      <option value="Honduras">Honduras</option>
                      <option value="Hong Kong">Hong Kong</option>
                      <option value="Hungary">Hungary</option>
                      <option value="Iceland">Iceland</option>
                      <option value="India">India</option>
                      <option value="Indonesia">Indonesia</option>
                      <option value="Iran">Iran</option>
                      <option value="Iraq">Iraq</option>
                      <option value="Ireland">Ireland</option>
                      <option value="Isle Of Man">Isle Of Man</option>
                      <option value="Italy">Italy</option>
                      <option value="Jamaica">Jamaica</option>
                      <option value="Japan">Japan</option>
                      <option value="Jersey">Jersey</option>
                      <option value="Jordan">Jordan</option>
                      <option value="Kazakhstan">Kazakhstan</option>
                      <option value="Kenya">Kenya</option>
                      <option value="Kiribati">Kiribati</option>
                      <option value="South Korea">Korea, South</option>
                      <option value="North Korea">Korea, North</option>
                      <option value="Kuwait">Kuwait</option>
                      <option value="Kyrgyzstan">Kyrgyzstan</option>
                      <option value="Lao People's Democratic Republic">Lao People's 
                      Dem. Rep.</option>
                      <option value="Latvia">Latvia</option>
                      <option value="Lebanon">Lebanon</option>
                      <option value="Lesotho">Lesotho</option>
                      <option value="Liberia">Liberia</option>
                      <option value="Libya">Libya</option>
                      <option value="Liechtenstein">Liechtenstein</option>
                      <option value="Lithuania">Lithuania</option>
                      <option value="Luxembourg">Luxembourg</option>
                      <option value="Macau">Macau</option>
                      <option value="Macedonia">Macedonia</option>
                      <option value="Madagascar">Madagascar</option>
                      <option value="Malawi">Malawi</option>
                      <option value="Malaysia">Malaysia</option>
                      <option value="Maldives">Maldives</option>
                      <option value="Mali">Mali</option>
                      <option value="Malta">Malta</option>
                      <option value="Marshall Islands">Marshall Islands</option>
                      <option value="Martinique">Martinique</option>
                      <option value="Mauritania">Mauritania</option>
                      <option value="Mauritius">Mauritius</option>
                      <option value="Mayotte">Mayotte</option>
                      <option value="Mexico">Mexico</option>
                      <option value="Micronesia">Micronesia</option>
                      <option value="Moldova">Moldova</option>
                      <option value="Monaco">Monaco</option>
                      <option value="Mongolia">Mongolia</option>
                      <option value="Montserrat">Montserrat</option>
                      <option value="Morocco">Morocco</option>
                      <option value="Mozambique">Mozambique</option>
                      <option value="Myanmar">Myanmar</option>
                      <option value="Namibia">Namibia</option>
                      <option value="Nauru">Nauru</option>
                      <option value="Nepal">Nepal</option>
                      <option value="Netherlands">Netherlands</option>
                      <option value="Netherlands Antilles">Netherlands Antilles</option>
                      <option value="Neutral Zone">Neutral Zone</option>
                      <option value="New Caledonia">New Caledonia</option>
                      <option value="New Zealand">New Zealand</option>
                      <option value="Nicaragua">Nicaragua</option>
                      <option value="Niger">Niger</option>
                      <option value="Nigeria">Nigeria</option>
                      <option value="Niue">Niue</option>
                      <option value="Norfolk Island">Norfolk Island</option>
                      <option value="Mariana Islands">Mariana Islands</option>
                      <option value="Norway">Norway</option>
                      <option value="Oman">Oman</option>
                      <option value="Palestine">Palestine</option>
                      <option value="Pakistan">Pakistan</option>
                      <option value="Palau">Palau</option>
                      <option value="Panama">Panama</option>
                      <option value="Papua New Guinea">Papua New Guinea</option>
                      <option value="Paraguay">Paraguay</option>
                      <option value="Peru">Peru</option>
                      <option value="Philippines">Philippines</option>
                      <option value="Pitcairn">Pitcairn</option>
                      <option value="Poland">Poland</option>
                      <option value="Polynesia">Polynesia</option>
                      <option value="Portugal">Portugal</option>
                      <option value="Puerto Rico">Puerto Rico</option>
                      <option value="Qatar">Qatar</option>
                      <option value="Reunion">Reunion</option>
                      <option value="Romania">Romania</option>
                      <option value="Russian Federation">Russian Federation</option>
                      <option value="Rwanda">Rwanda</option>
                      <option value="Saint Helena">Saint Helena</option>
                      <option value="Saint Kitts">Saint Kitts</option>
                      <option value="Saint Lucia">Saint Lucia</option>
                      <option value="Saint Pierre">Saint Pierre</option>
                      <option value="Saint Vincent">Saint Vincent</option>
                      <option value="Samoa">Samoa</option>
                      <option value="San Marino">San Marino</option>
                      <option value="Sao Tome and Principe">Sao Tome and Principe</option>


                      <option value="Saudi Arabia">Saudi Arabia</option>
                      <option value="Senegal">Senegal</option>
                      <option value="Seychelles">Seychelles</option>
                      <option value="Sierra Leone">Sierra Leone</option>
                      <option value="Singapore">Singapore</option>
                      <option value="Slovakia">Slovakia</option>
                      <option value="Slovenia">Slovenia</option>
                      <option value="Solomon Islands">Solomon Islands</option>
                      <option value="Somalia">Somalia</option>
                      <option value="South Africa">South Africa</option>
                      <option value="South Georgia">South Georgia</option>
                      <option value="Spain">Spain</option>
                      <option value="Sri Lanka">Sri Lanka</option>
                      <option value="Sudan">Sudan</option>
                      <option value="Suriname">Suriname</option>
                      <option value="Svalbard">Svalbard</option>
                      <option value="Swaziland">Swaziland</option>
                      <option value="Sweden">Sweden</option>
                      <option value="Switzerland">Switzerland</option>
                      <option value="Syrian Arab Republic">Syrian Arab Republic</option>
                      <option value="Taiwan">Taiwan</option>
                      <option value="Tajikista">Tajikista</option>
                      <option value="Tanzania">Tanzania</option>
                      <option value="Thailand">Thailand</option>
                      <option value="Togo">Togo</option>
                      <option value="Tokelau">Tokelau</option>
                      <option value="Tonga">Tonga</option>
                      <option value="Trinidad and Tobago">Trinidad and Tobago</option>
                      <option value="Tunisia">Tunisia</option>
                      <option value="Turkey">Turkey</option>


                      <option value="TM">Turkmenistan</option>
                      <option value="Turkmenistan">Turks and Caicos Islands</option>
                      <option value="Tuvalu">Tuvalu</option>
                      <option value="Uganda">Uganda</option>
                      <option value="Ukraine">Ukraine</option>
                      <option value="United Arab Emirates">United Arab Emirates</option>
                      <option value="United Kingdom">United Kingdom</option>
                      <option value="United States">United States</option>
                      <option value="Uruguay">Uruguay</option>
                      <option value="USSR">USSR</option>
                      <option value="Uzbekistan">Uzbekistan</option>
                      <option value="Vanuatu">Vanuatu</option>
                      <option value="Vatican City State">Vatican City State</option>
                      <option value="Venezuela">Venezuela</option>
                      <option value="Vietnam">Vietnam</option>
                      <option value="Virgin Islands">Virgin Islands</option>
                      <option value="Western Sahara">Western Sahara</option>
                      <option value="Yemen">Yemen</option>
                      <option value="Yugoslavia">Yugoslavia</option>
                      <option value="Zaire">Zaire</option>
                      <option value="Zambia">Zambia</option>
                      <option value="Zimbabwe">Zimbabwe</option>
                    </select></b></font><b><font size="2" face="Tahoma" color="#000000"> </font>
                    </b>
                  </td>
                </tr>
                <tr class="arial"> 
                  <td align="right" width="80" class="arial" height="12">
                  <p align="left"><b>
                  <font size="2" face="Tahoma" color="#000000">E-mail:</font></b></p></td>
                  <td height="12" width="358"> 
                    <font face="Tahoma" color="#000000"><b> 
                    <input type="text" name="email" size="30" maxlength="50"></b></font><b><font size="2" face="Tahoma" color="#000000">
                    </font></b>
                  </td>
                </tr>
                <tr class="arial"> 
                  <td align="right" width="80" class="arial" height="12">
                  <p align="left"><b>
                  <font size="2" face="Tahoma" color="#000000">Hompage:</font></b></p></td>
                  <td height="12" width="358"> 
                    <font face="Tahoma" color="#000000"><b> 
                    <input type="text" name="homepage" size="30" maxlength="50" value="http://"></b></font><b><font size="2" face="Tahoma" color="#000000">
                    </font></b>
                  </td>
                </tr>
                <tr class="arial"> 
                        <td valign="top" align="right" height="31" width="80" class="arial">&nbsp;</td>
                        <td height="31" width="358" valign="bottom"> 
                          <font face="Tahoma" color="#000000"><b> 
                          <input type="button" value="Bold" onclick="AddMessageCode('B','Enter text you want formatted in Bold', '')" name="button"></b></font><b><font size="2" face="Tahoma" color="#000000">
                          </font></b><font face="Tahoma" color="#000000"><b>
                          <input type="button" value="Italic" onclick="AddMessageCode('I','Enter text you want formatted in Italic', '')" name="button"></b></font><b><font size="2" face="Tahoma" color="#000000">
                          </font></b><font face="Tahoma" color="#000000"><b>
                          <input type="button" value="Underline" onclick="AddMessageCode('U','Enter text you want Underlined', '')" name="button"></b></font><b><font size="2" face="Tahoma" color="#000000">
                          </font></b>
                        </td>
                      </tr> 
                <tr class="arial"> 
                  <td valign="top" align="right" height="61" width="80" class="arial">
                  <p align="left">
                  <b><font size="2" face="Tahoma" color="#000000">Comments*:</font></b></p></td>
                  <td height="61" width="358" valign="top"> 
                    <font face="Tahoma" color="#000000"><b> 
                    <textarea name="comments" cols="40" rows="6"></textarea></b></font><b><font size="2" face="Tahoma" color="#000000">
                    </font></b>
                  </td>
                </tr>
                <tr> 
                  <td valign="top" align="right" height="2" width="80" class="arial">
                  <b><font size="2" face="Tahoma" color="#000000">&nbsp; </font></b> 
                  </td>
                  <td height="2" width="358"> 
                    <p> 
                      <font face="Tahoma" color="#000000"><b> 
                      <input type="submit" name="Submit" value="Add to Guestbook"></b></font><b><font size="2" face="Tahoma" color="#000000">
                      </font></b><font face="Tahoma" color="#000000"><b>
                      <input type="reset" name="Reset" value="Clear Form"></b></font><b><font size="2" face="Tahoma" color="#000000">
                      </font></b>
                    </p>
                  </td>
                </tr>
              </tbody></table>
                </center>
              </div>
            </td>
          </tr>
        </tbody></table>
      </td>
      <td width="42%" align="center" valign="top"><b>
      <font size="2" face="Tahoma" color="#000000"><br>
        Click on Icon to add to your message<br>
              <br>
              
        </font></b>
              
        <table width="20" border="0" cellspacing="2" cellpadding="2" align="center">
          <tbody><tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon(':)')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley1.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
          <tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon(';)')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley2.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
          <tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon(':o')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley3.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
          <tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon(':D')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley4.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
          <tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon(':errr:')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley5.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
          <tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon(':(')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley6.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
          <tr> 
            <td width="10" align="center"><b><a href="javascript:AddSmileyIcon('X(')">
            <font color="#000000" size="2" face="Tahoma"><img src="http://www.omayya.com/guestbook/guestbook_images/smiley7.gif" width="17" height="17" border="0"></font></a></b></td>
          </tr>
        </tbody></table>
      </td>
    </tr>
  </tbody></table>
    </center>
  </div>
</form>



</body><!-- https://web.archive.org/web/20030805042759if_/http://www.omayya.com:80/guestbook/sign.asp -->
</html><!--
     FILE ARCHIVED ON 04:27:59 Aug 05, 2003 AND RETRIEVED FROM THE
     INTERNET ARCHIVE ON 04:31:45 Feb 11, 2026.
     JAVASCRIPT APPENDED BY WAYBACK MACHINE, COPYRIGHT INTERNET ARCHIVE.

     ALL OTHER CONTENT MAY ALSO BE PROTECTED BY COPYRIGHT (17 U.S.C.
     SECTION 108(a)(3)).
--><!--
playback timings (ms):
  captures_list: 0.689
  exclusion.robots: 0.055
  exclusion.robots.policy: 0.042
  esindex: 0.014
  cdx.remote: 21.148
  LoadShardBlock: 81.892 (3)
  PetaboxLoader3.datanode: 95.538 (4)
  load_resource: 168.112
  PetaboxLoader3.resolve: 31.614
-->