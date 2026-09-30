Pod::Spec.new do |s|
  s.name           = 'CheckoffMovement'
  s.version        = '1.0.0'
  s.summary        = 'Significant-location-change wake-ups for CheckOff visit-recovery coverage refresh'
  s.description    = 'Starts the OS significant-location-change service (cell-tower based, relaunches a terminated app) and hands the raw movement hints to JS. It never decides dwell, visits, check-offs or points.'
  s.license        = 'UNLICENSED'
  s.author         = 'CheckOff'
  s.homepage       = 'https://getcheckoff.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
