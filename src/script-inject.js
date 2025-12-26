import path from 'path';
import fs from 'fs';

let Files = [];

function ThroughDirectory(Directory) {
  fs.readdirSync(Directory).forEach((File) => {
    const Absolute = path.join(Directory, File);
    if (fs.statSync(Absolute).isDirectory())
      return ThroughDirectory(Absolute);
    else if (
      path.extname(File) === '.htm' ||
      path.extname(File) === '.html' || 
      path.extname(File) === '.shtml'
    )
      return Files.push(Absolute);
  });
}

ThroughDirectory(process.argv[2]);

// console.log('FILES', Files);

Files.forEach((filePath) => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the HTML file:', err);
      return;
    }


    let body = data.replace('</body>\n  <script src="/onload.js"></script>', '</body>');

    body = body.replace(
      /<\/body>/g,
      '</body>\n  <script src="/onload.js"></script>'
    );

    fs.writeFile(filePath, body, 'utf8', function (err) {
      if (err) return console.log(err);
    });
    // Print the content to the console
    // console.log(data);
  });
});
