'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ProcessingResult {
  manual_id: string;
  summary: string | null;
  chunks_count: number;
}

interface UploadResult {
  fileName: string;
  originalFileName: string;
  encodedFileName: string;
  fileSize: number;
  fileType: string;
}

export default function TestPDFPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [processingResult, setProcessingResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setUploadResult(null);
      setProcessingResult(null);
      setLogs([]);
      addLog(`Selected file: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setIsUploading(true);
    setError(null);
    addLog('Starting file upload...');

    try {
      // Get auth token (assuming user is logged in via Clerk)
      const token = await (window as any).Clerk?.session?.getToken();
      if (!token) {
        throw new Error('Not authenticated. Please log in first.');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('originalFileName', file.name);

      addLog('Sending upload request to /api/upload-manual...');
      const uploadResponse = await fetch('/api/upload-manual', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const uploadData: UploadResult = await uploadResponse.json();
      setUploadResult(uploadData);
      addLog(`Upload successful: ${uploadData.fileName}`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      addLog(`Upload error: ${errorMessage}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleProcess = async () => {
    if (!uploadResult) {
      setError('Please upload a file first');
      return;
    }

    setIsProcessing(true);
    setError(null);
    addLog('Starting PDF processing...');

    try {
      // Get auth token
      const token = await (window as any).Clerk?.session?.getToken();
      if (!token) {
        throw new Error('Not authenticated. Please log in first.');
      }

      const requestBody = {
        fileName: uploadResult.fileName,
        originalFileName: uploadResult.originalFileName,
      };

      addLog('Sending processing request to /api/process-pdf...');
      addLog('Note: This may take several minutes for large PDF files...');
      
      const processResponse = await fetch('/api/process-pdf', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!processResponse.ok) {
        const errorData = await processResponse.json();
        throw new Error(errorData.error || 'Processing failed');
      }

      const processData: ProcessingResult = await processResponse.json();
      setProcessingResult(processData);
      addLog(`Processing successful: ${processData.chunks_count} chunks created`);
      if (processData.summary) {
        addLog(`Summary generated: ${processData.summary.substring(0, 100)}...`);
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Processing failed';
      setError(errorMessage);
      addLog(`Processing error: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFullTest = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    // Clear previous results
    setUploadResult(null);
    setProcessingResult(null);
    setError(null);
    setLogs([]);

    // Upload first
    await handleUpload();
    
    // Wait a moment and then process if upload was successful
    setTimeout(async () => {
      if (uploadResult && !error) {
        await handleProcess();
      }
    }, 1000);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">PDF Processing Test (Vercel Functions)</h1>
      
      <div className="grid gap-6">
        {/* File Selection */}
        <Card>
          <CardHeader>
            <CardTitle>1. Select File</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              onChange={handleFileChange}
              className="mb-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {file && (
              <div className="text-sm text-gray-600">
                <p>Selected: {file.name}</p>
                <p>Size: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
                <p>Type: {file.type}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <Card>
          <CardHeader>
            <CardTitle>2. Test Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button 
                onClick={handleUpload} 
                disabled={!file || isUploading}
                variant="outline"
              >
                {isUploading ? 'Uploading...' : 'Upload Only'}
              </Button>
              
              <Button 
                onClick={handleProcess} 
                disabled={!uploadResult || isProcessing}
                variant="outline"
              >
                {isProcessing ? 'Processing...' : 'Process Only'}
              </Button>
              
              <Button 
                onClick={handleFullTest} 
                disabled={!file || isUploading || isProcessing}
                variant="default"
              >
                {isUploading || isProcessing ? 'Running...' : 'Full Test (Upload + Process)'}
              </Button>
            </div>
            
            <p className="text-sm text-gray-600">
              Note: Processing large PDF files may take several minutes due to Vercel's 5-minute function timeout.
            </p>
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {uploadResult && (
          <Card>
            <CardHeader>
              <CardTitle>Upload Result</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <p><strong>File Name:</strong> {uploadResult.fileName}</p>
                <p><strong>Original Name:</strong> {uploadResult.originalFileName}</p>
                <p><strong>Encoded Name:</strong> {uploadResult.encodedFileName}</p>
                <p><strong>Size:</strong> {(uploadResult.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                <p><strong>Type:</strong> {uploadResult.fileType}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {processingResult && (
          <Card>
            <CardHeader>
              <CardTitle>Processing Result</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <p><strong>Manual ID:</strong> {processingResult.manual_id}</p>
                <p><strong>Chunks Created:</strong> {processingResult.chunks_count}</p>
                {processingResult.summary && (
                  <div>
                    <p><strong>Summary:</strong></p>
                    <p className="pl-4 italic">{processingResult.summary}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Process Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap">
                  {logs.join('\n')}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
} 