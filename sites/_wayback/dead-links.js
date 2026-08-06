document.addEventListener('click',function(e){var el=e.target.closest&&e.target.closest('a.dead,area.dead');if(el){e.preventDefault();e.stopPropagation();}},true);
