
import Foundation
import Vision

@objc(OcrModule)
class OcrModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(recognize:resolver:rejecter:)
  func recognize(_ imagePath: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    let path = imagePath.hasPrefix("file://") ? String(imagePath.dropFirst(7)) : imagePath
    let url = URL(fileURLWithPath: path)
    let req = VNRecognizeTextRequest { r, e in
      if let e = e { reject("VISION_ERR", e.localizedDescription, e); return }
      guard let obs = r.results as? [VNRecognizedTextObservation] else { resolve([]); return }
      let out = obs.compactMap { o -> [String: Any]? in
        guard let best = o.topCandidates(1).first else { return nil }
        let b = o.boundingBox
        return ["text": best.string, "bbox": ["x": b.origin.x, "y": b.origin.y, "w": b.size.width, "h": b.size.height]]
      }
      resolve(out)
    }
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    do { try VNImageRequestHandler(url: url, options: [:]).perform([req]) }
    catch { reject("VISION_RUN_ERR", error.localizedDescription, error) }
  }
}
