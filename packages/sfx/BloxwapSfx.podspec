require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Lives at the package root (expo-module.config.json points at it) so the sounds in native/assets, shared
# with Android, sit inside the pod.
Pod::Spec.new do |s|
  s.name           = 'BloxwapSfx'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/bloxwap/sfx.git', tag: "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = 'ios/**/*.swift'
  s.resource_bundles = { 'BloxwapSfx' => ['native/assets/bloxwap-sfx/*.wav'] }
end
