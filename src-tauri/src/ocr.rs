// Texterkennung (OCR) mit der Bilderkennung von macOS (Vision). Für eingescannte oder fotografierte Kontoauszüge.
// Bekommt ein Bild (JPEG/PNG) als Rohdaten und liefert die erkannten Textstücke mit ihrer Lage auf der Seite.

#[derive(serde::Serialize)]
pub struct Wort {
  pub s: String,
  /// linke Kante, 0 bis 1
  pub x: f64,
  /// Mitte der Zeile von unten gemessen, 0 bis 1
  pub y: f64,
  /// Zeilenhöhe, 0 bis 1
  pub h: f64,
}

#[tauri::command]
pub async fn ocr_bild(request: tauri::ipc::Request<'_>) -> Result<Vec<Wort>, String> {
  let bild = match request.body() {
    tauri::ipc::InvokeBody::Raw(b) => b.clone(),
    _ => return Err("Kein Bild übergeben.".into()),
  };
  tauri::async_runtime::spawn_blocking(move || erkennen(&bild)).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn erkennen(bild: &[u8]) -> Result<Vec<Wort>, String> {
  use objc2::AnyThread;
  use objc2::rc::{autoreleasepool, Retained};
  use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
  use objc2_vision::{VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel};

  autoreleasepool(|_| unsafe {
    let data = NSData::with_bytes(bild);
    let handler = VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &NSDictionary::new());
    let req = VNRecognizeTextRequest::init(VNRecognizeTextRequest::alloc());
    req.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    req.setUsesLanguageCorrection(false);
    req.setRecognitionLanguages(&NSArray::from_retained_slice(&[NSString::from_str("de-DE"), NSString::from_str("en-US")]));
    let anfrage: Retained<VNRequest> = Retained::into_super(Retained::into_super(req.clone()));
    handler
      .performRequests_error(&NSArray::from_retained_slice(&[anfrage]))
      .map_err(|e| format!("Texterkennung fehlgeschlagen: {}", e.localizedDescription()))?;
    let mut aus = Vec::new();
    if let Some(ergebnisse) = req.results() {
      for obs in ergebnisse.iter() {
        if let Some(k) = obs.topCandidates(1).firstObject() {
          let r = obs.boundingBox();
          aus.push(Wort { s: k.string().to_string(), x: r.origin.x, y: r.origin.y + r.size.height / 2.0, h: r.size.height });
        }
      }
    }
    Ok(aus)
  })
}

#[cfg(not(target_os = "macos"))]
fn erkennen(_bild: &[u8]) -> Result<Vec<Wort>, String> {
  Err("Die Texterkennung gibt es nur in der Mac-App.".into())
}
