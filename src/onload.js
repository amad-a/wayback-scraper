console.log('🔑 START', location.pathname);

const a = document.body.getElementsByTagName('a');
const img = document.body.getElementsByTagName('img');

console.log('LINKS', a);

for (let i = 0; i < img.length; i++) {
  // console.log('img', img[i].src);
  img[i].src = img[i].src.replace(
    /https:\/\/web\.archive\.org\/web\/\d{14}im_\/http:\/\//,
    '/sites/'
  );
  if (
    img[i].src.match(
      /https:\/\/web\.archive\.org\/web\/\d{14}im_\/http:\/\//
    )
  ) {

  }
}

for (let i = 0; i < a.length; i++) {
  // imgs[i].src = imgs[i].src.substring(58);

  // TODO: figure out if link exists, if not then

  if (a[i].href.match(/\/web\/\d{14}\/http:\/\//)) {
    a[i].href = a[i].href.replace(
      /\/web\/\d{14}\/http:\/\//,
      '/sites/'
    );
    console.log('edited', a[i].href);
  }

  if (a[i].href.includes('https://web.archive.org')) {
    a[i].classList.add('pal-online-wayback');
    const clonedNode = a[i].cloneNode(true);

    const newSpan = document.createElement('span');
    newSpan.appendChild(clonedNode);
    newSpan.classList.add('pal-online-wayback-parent');

    a[i].replaceWith(newSpan);
  }
}
