# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.praveen_kumar_s.client.* {
  native <methods>;
}

-keep class com.praveen_kumar_s.client.WryActivity {
  public <init>(...);

  void setWebView(com.praveen_kumar_s.client.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class com.praveen_kumar_s.client.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.praveen_kumar_s.client.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.praveen_kumar_s.client.RustWebChromeClient,com.praveen_kumar_s.client.RustWebViewClient {
  public <init>(...);
}
