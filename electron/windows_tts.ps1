param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('list', 'synthesize')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]

function Read-Request {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return [pscustomobject]@{}
  }
  return $raw | ConvertFrom-Json
}

function Await-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)]
    $Operation,
    [Parameter(Mandatory = $true)]
    [Type]$ResultType
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetGenericArguments().Count -eq 1 -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  if (-not $method) {
    throw '无法找到 Windows Runtime AsTask 转换方法。'
  }

  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

function Get-VoiceObjects {
  $voices = @()
  foreach ($voice in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    $voices += [pscustomobject]@{
      id = [string]$voice.Id
      name = [string]$voice.DisplayName
      language = [string]$voice.Language
      gender = [string]$voice.Gender
      description = [string]$voice.Description
    }
  }
  return $voices
}

try {
  $request = Read-Request

  if ($Mode -eq 'list') {
    [pscustomobject]@{
      voices = @(Get-VoiceObjects)
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
  }

  $text = [string]$request.text
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw '没有可朗读的文字。'
  }

  $rate = 1.0
  if ($null -ne $request.rate) {
    $rate = [double]$request.rate
  }
  $rate = [Math]::Min(2.0, [Math]::Max(0.5, $rate))

  $synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
  try {
    $voiceId = [string]$request.voiceId
    if (-not [string]::IsNullOrWhiteSpace($voiceId)) {
      $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
        Where-Object { $_.Id -eq $voiceId } |
        Select-Object -First 1
      if ($voice) {
        $synth.Voice = $voice
      }
    }

    $synth.Options.SpeakingRate = $rate
    $stream = Await-WinRtOperation -Operation ($synth.SynthesizeTextToStreamAsync($text)) -ResultType ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

    try {
      $managedStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
      $memory = [System.IO.MemoryStream]::new()
      try {
        $managedStream.CopyTo($memory)
        $audioBytes = $memory.ToArray()
      }
      finally {
        $memory.Dispose()
        $managedStream.Dispose()
      }

      [pscustomobject]@{
        mimeType = [string]$stream.ContentType
        audioBase64 = [Convert]::ToBase64String($audioBytes)
        voiceId = [string]$synth.Voice.Id
        voiceName = [string]$synth.Voice.DisplayName
        language = [string]$synth.Voice.Language
      } | ConvertTo-Json -Depth 4 -Compress
    }
    finally {
      $stream.Dispose()
    }
  }
  finally {
    $synth.Dispose()
  }
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
