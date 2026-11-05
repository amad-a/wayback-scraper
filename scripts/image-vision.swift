// What macOS's Vision framework sees in each image: scene labels, recognised text and
// faces. Reads one image path per line on stdin and writes one JSON object per line to
// stdout, in no particular order. Used by src/build-image-aliases.js, which caches the
// results; run on its own it is just:
//
//   find sites -name '*.gif' | swift scripts/image-vision.swift > vision.jsonl
//
// Vision ships with macOS, so there is nothing to install.
import Foundation
import ImageIO
import Vision

var paths: [String] = []
while let line = readLine() {
  if !line.isEmpty { paths.append(line) }
}

let output = FileHandle.standardOutput
let lock = NSLock()

// Vision wants something bigger than a 16px bullet; tiny images are scaled up first.
func load(_ path: String) -> CGImage? {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
  let shortest = min(image.width, image.height)
  guard shortest < 64, shortest > 0 else { return image }
  let scale = 64 / Double(shortest)
  let w = Int(Double(image.width) * scale), h = Int(Double(image.height) * scale)
  guard w <= 4096, h <= 4096,
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.interpolationQuality = .none
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return ctx.makeImage() ?? image
}

DispatchQueue.concurrentPerform(iterations: paths.count) { i in
  let path = paths[i]
  var result: [String: Any] = ["path": path]
  if let image = load(path) {
    let classify = VNClassifyImageRequest()
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.recognitionLanguages = ["ar", "en-US", "fr-FR"]
    text.usesLanguageCorrection = false
    let faces = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
      try handler.perform([classify, text, faces])
      var labels: [String: Double] = [:]
      for o in classify.results ?? [] where o.confidence >= 0.2 {
        labels[o.identifier] = (Double(o.confidence) * 100).rounded() / 100
      }
      result["labels"] = labels
      result["text"] = (text.results ?? []).compactMap { $0.topCandidates(1).first?.string }
      result["faces"] = faces.results?.count ?? 0
    } catch {
      result["error"] = "\(error)"
    }
  } else {
    result["error"] = "unreadable"
  }
  if let data = try? JSONSerialization.data(withJSONObject: result) {
    lock.lock()
    output.write(data)
    output.write("\n".data(using: .utf8)!)
    lock.unlock()
  }
}
