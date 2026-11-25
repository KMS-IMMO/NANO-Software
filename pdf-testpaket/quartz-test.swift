// Prüft PDFs mit Quartz (macOS): Text lesen, über PDFKit neu speichern, wie beim Drucken neu zeichnen, Seite 1 als PNG.
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

func png(_ url: URL, _ out: URL) {
  guard let d = CGPDFDocument(url as CFURL), let p = d.page(at: 1) else { print("  PNG: kann nicht öffnen"); return }
  let r = p.getBoxRect(.mediaBox); let s: CGFloat = 1.5
  let ctx = CGContext(data: nil, width: Int(r.width*s), height: Int(r.height*s), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: r.width*s, height: r.height*s))
  ctx.scaleBy(x: s, y: s); ctx.drawPDFPage(p)
  let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}
func drucken(_ url: URL, _ out: URL) {
  let d = CGPDFDocument(url as CFURL)!
  var box = d.page(at: 1)!.getBoxRect(.mediaBox)
  let ctx = CGContext(out as CFURL, mediaBox: &box, nil)!
  for i in 1...d.numberOfPages { let p = d.page(at: i)!; var b = p.getBoxRect(.mediaBox); ctx.beginPage(mediaBox: &b); ctx.drawPDFPage(p); ctx.endPage() }
  ctx.closePDF()
}
func text(_ url: URL) -> String { (PDFDocument(url: url)?.string ?? "<nicht lesbar>").replacingOccurrences(of: "\n", with: " | ").prefix(90).description }

let dir = URL(fileURLWithPath: CommandLine.arguments[1])
let aus = dir.appendingPathComponent("ergebnis"); try? FileManager.default.createDirectory(at: aus, withIntermediateDirectories: true)
for f in try! FileManager.default.contentsOfDirectory(atPath: dir.path).filter({ $0.hasSuffix(".pdf") }).sorted() {
  let u = dir.appendingPathComponent(f); let n = (f as NSString).deletingPathExtension
  print("== \(f)"); print("  Text original:      \(text(u))")
  let k = aus.appendingPathComponent("\(n)-pdfkit.pdf"); PDFDocument(url: u)!.write(to: k)
  print("  Text nach PDFKit:   \(text(k))")
  let dr = aus.appendingPathComponent("\(n)-druck.pdf"); drucken(u, dr)
  print("  Text nach Drucken:  \(text(dr))")
  png(u, aus.appendingPathComponent("\(n)-original.png")); png(k, aus.appendingPathComponent("\(n)-pdfkit.png")); png(dr, aus.appendingPathComponent("\(n)-druck.png"))
}
