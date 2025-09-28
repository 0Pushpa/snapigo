// Apple Vision OCR native bridge (Objective-C++) for Expo/React Native.
// Safe version: does NOT modify HEADER_SEARCH_PATHS or any Swift bridging settings.

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const HEADER_H = `
#import <React/RCTBridgeModule.h>
@interface OcrModule : NSObject <RCTBridgeModule>
@end
`;

const SOURCE_MM = `
#import "OcrModule.h"
#import <Vision/Vision.h>

@implementation OcrModule
RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(recognize,
                 recognizeWithPath:(NSString *)imagePath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *path = [imagePath hasPrefix:@"file://"] ? [imagePath substringFromIndex:7] : imagePath;
  NSURL *url = [NSURL fileURLWithPath:path];

  VNRecognizeTextRequest *req = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *r, NSError *e) {
    if (e) { reject(@"VISION_ERR", e.localizedDescription, e); return; }
    NSMutableArray *out = [NSMutableArray array];
    for (VNRecognizedTextObservation *obs in (NSArray<VNRecognizedTextObservation *> *)r.results) {
      VNRecognizedText *best = [[obs topCandidates:1] firstObject];
      if (!best) continue;
      CGRect b = obs.boundingBox; // normalized 0..1
      [out addObject:@{
        @"text": best.string ?: @"",
        @"bbox": @{@"x": @(b.origin.x), @"y": @(b.origin.y), @"w": @(b.size.width), @"h": @(b.size.height)}
      }];
    }
    resolve(out);
  }];
  req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  req.usesLanguageCorrection = YES;

  NSError *err = nil;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
  if (![handler performRequests:@[req] error:&err]) {
    reject(@"VISION_RUN_ERR", err.localizedDescription, err);
  }
}
@end
`;

module.exports = function withAppleVisionOCR(config) {
  // 1) Write Obj-C++ sources into ios/NativeModules
  config = withDangerousMod(config, ['ios', (c) => {
    const iosRoot = c.modRequest.platformProjectRoot;
    const modDir = path.join(iosRoot, 'NativeModules');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
    fs.writeFileSync(path.join(modDir, 'OcrModule.h'), HEADER_H);
    fs.writeFileSync(path.join(modDir, 'OcrModule.mm'), SOURCE_MM);

    // Remove any leftover Swift attempt (optional)
    try { fs.rmSync(path.join(modDir, 'OcrModule.swift')); } catch {}
    try { fs.rmSync(path.join(iosRoot, 'Snapigo-Bridging-Header.h')); } catch {}

    return c;
  }]);

  // 2) Add files to Xcode project + only flip the script sandbox (leave header paths alone)
  config = withXcodeProject(config, (c) => {
    const project = c.modResults;

    const groupName = 'NativeModules';
    const group = project.pbxGroupByName(groupName) || project.addPbxGroup([], groupName, groupName);

    const add = (rel) => {
      if (!project.hasFile(rel)) {
        project.addSourceFile(rel, { target: project.getFirstTarget().uuid }, group.uuid);
      }
    };
    add('NativeModules/OcrModule.h');
    add('NativeModules/OcrModule.mm'); // Obj-C++

    // Disable Xcode 15+ User Script Sandboxing (Expo/RN scripts need to read Pods files)
    const cfgs = project.pbxXCBuildConfigurationSection();
    Object.keys(cfgs).forEach((k) => {
      const bs = cfgs[k] && cfgs[k].buildSettings;
      if (!bs) return;
      bs.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';

      // Do NOT touch HEADER_SEARCH_PATHS or any SWIFT_* keys here.
    });

    return c;
  });

  return config;
};
