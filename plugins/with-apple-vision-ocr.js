const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('fs'); const path = require('path');

const swiftSrc = `
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
`;

const objcSrc = `
#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(OcrModule, NSObject)
RCT_EXTERN_METHOD(recognize:(NSString *)imagePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
`;

module.exports = function withAppleVisionOCR(config) {
  // 1) Write native files
  config = withDangerousMod(config, ['ios', c => {
    const iosRoot = c.modRequest.platformProjectRoot;
    const modDir = path.join(iosRoot, 'NativeModules');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
    fs.writeFileSync(path.join(modDir, 'OcrModule.swift'), swiftSrc);
    fs.writeFileSync(path.join(modDir, 'OcrModule.m'), objcSrc);
    const bridging = path.join(iosRoot, 'Snapigo-Bridging-Header.h');
    if (!fs.existsSync(bridging)) fs.writeFileSync(bridging, '#import <React/RCTBridgeModule.h>\n');
    return c;
  }]);

  // 2) Link into Xcode project + set bridging header
  config = withXcodeProject(config, c => {
    const project = c.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(project);
    const groupPath = path.join(projectName, 'NativeModules');
    const group = project.pbxGroupByName('NativeModules') || project.addPbxGroup([], 'NativeModules', 'NativeModules', groupPath);

    const add = rel => { if (!project.hasFile(rel)) project.addSourceFile(rel, { target: project.getFirstTarget().uuid }, group.uuid); };
    add('NativeModules/OcrModule.swift');
    add('NativeModules/OcrModule.m');

    project.addBuildProperty('SWIFT_OBJC_BRIDGING_HEADER', '"$(PROJECT_DIR)/ios/Snapigo-Bridging-Header.h"');
    project.addBuildProperty('SWIFT_VERSION', '5.0');
    return c;
  });

  return config;
};
