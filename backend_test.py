#!/usr/bin/env python3
"""
MoneyBook Backend API Testing
Tests all backend endpoints for the MoneyBook WhatsApp-style bookkeeping app.
"""

import requests
import json
import sys
from datetime import datetime, date

class MoneyBookAPITester:
    def __init__(self, base_url="https://app-runner-99.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_phone = f"9876543{datetime.now().strftime('%H%M')}"  # 10 digit phone
        self.test_store_name = "Test Store"

    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params or {})
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, params=params or {})

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    self.log(f"   Error: {error_data}")
                except:
                    self.log(f"   Response: {response.text[:200]}")
                return False, {}

        except Exception as e:
            self.log(f"❌ {name} - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test backend health check endpoint"""
        return self.run_test(
            "Health Check",
            "GET", 
            "../health",  # health is at root level, not /api/health
            200
        )

    def test_login_api(self):
        """Test login API with phone number"""
        success, response = self.run_test(
            "Login API",
            "POST",
            "login",
            200,
            data={"phone": self.test_phone, "store_name": self.test_store_name}
        )
        if success:
            self.log(f"   Store ID: {response.get('store_id')}")
            self.log(f"   Phone: {response.get('phone')}")
            self.log(f"   Name: {response.get('name')}")
        return success, response

    def test_messages_api(self):
        """Test messages API polling"""
        return self.run_test(
            "Messages API",
            "GET",
            "messages",
            200,
            params={"phone": f"web:+91{self.test_phone}", "after_id": 0}
        )

    def test_send_message_api(self):
        """Test sending a message"""
        return self.run_test(
            "Send Message API",
            "POST",
            "message",
            200,
            data={
                "phone": f"web:+91{self.test_phone}",
                "body": "Test message for API testing",
                "language": "hinglish"
            }
        )

    def test_profile_api(self):
        """Test profile API"""
        return self.run_test(
            "Profile API",
            "GET",
            "profile",
            200,
            params={"phone": f"web:+91{self.test_phone}"}
        )

    def test_analytics_api(self):
        """Test analytics API"""
        return self.run_test(
            "Analytics API",
            "GET",
            "analytics",
            200,
            params={"phone": f"web:+91{self.test_phone}", "period": "day"}
        )

    def test_dues_api(self):
        """Test dues API"""
        return self.run_test(
            "Dues API",
            "GET",
            "dues",
            200,
            params={"phone": f"web:+91{self.test_phone}"}
        )

    def test_image_upload_api(self):
        """Test image upload API and verify media_url format"""
        self.log("🔍 Testing Image Upload API...")
        try:
            # Create a simple test image file
            import io
            from PIL import Image
            
            # Create a small test image
            img = Image.new('RGB', (100, 100), color='red')
            img_bytes = io.BytesIO()
            img.save(img_bytes, format='JPEG')
            img_bytes.seek(0)
            
            # Prepare multipart form data
            files = {
                'file': ('test_image.jpg', img_bytes, 'image/jpeg')
            }
            data = {
                'phone': f"web:+91{self.test_phone}",
                'language': 'hinglish'
            }
            
            url = f"{self.base_url}/api/image"
            response = requests.post(url, files=files, data=data)
            
            self.tests_run += 1
            if response.status_code == 200:
                result = response.json()
                media_url = result.get('media_url', '')
                
                # Check if media_url has /api/uploads/ prefix
                if media_url.startswith('/api/uploads/'):
                    self.tests_passed += 1
                    self.log("✅ Image Upload API - Success")
                    self.log(f"   Media URL: {media_url}")
                    return True, media_url
                else:
                    self.log(f"❌ Image Upload API - Wrong media_url format: {media_url}")
                    return False, None
            else:
                self.log(f"❌ Image Upload API - Status: {response.status_code}")
                try:
                    error_data = response.json()
                    self.log(f"   Error: {error_data}")
                except:
                    self.log(f"   Response: {response.text[:200]}")
                return False, None
                
        except Exception as e:
            self.log(f"❌ Image Upload API - Error: {str(e)}")
            return False, None

    def test_image_accessibility(self, media_url):
        """Test if uploaded image is accessible via external URL"""
        if not media_url:
            return False
            
        self.log("🔍 Testing Image Accessibility...")
        try:
            # Test accessing the image via external URL
            image_url = f"{self.base_url}{media_url}"
            response = requests.get(image_url)
            
            self.tests_run += 1
            if response.status_code == 200 and response.headers.get('content-type', '').startswith('image/'):
                self.tests_passed += 1
                self.log("✅ Image Accessibility - Success")
                self.log(f"   Image URL: {image_url}")
                self.log(f"   Content-Type: {response.headers.get('content-type')}")
                return True
            else:
                self.log(f"❌ Image Accessibility - Status: {response.status_code}")
                self.log(f"   Content-Type: {response.headers.get('content-type')}")
                return False
                
        except Exception as e:
            self.log(f"❌ Image Accessibility - Error: {str(e)}")
            return False

    def test_cors_headers(self):
        """Test CORS headers in API responses"""
        self.log("🔍 Testing CORS Headers...")
        try:
            response = requests.options(f"{self.base_url}/api/login")
            cors_headers = {
                'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
                'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
                'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
            }
            
            self.tests_run += 1
            if cors_headers['Access-Control-Allow-Origin']:
                self.tests_passed += 1
                self.log("✅ CORS Headers - Present")
                self.log(f"   Origin: {cors_headers['Access-Control-Allow-Origin']}")
                self.log(f"   Methods: {cors_headers['Access-Control-Allow-Methods']}")
                return True
            else:
                self.log("❌ CORS Headers - Missing")
                return False
        except Exception as e:
            self.log(f"❌ CORS Headers - Error: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all backend tests"""
        self.log("🚀 Starting MoneyBook Backend API Tests")
        self.log(f"   Base URL: {self.base_url}")
        self.log(f"   Test Phone: {self.test_phone}")
        
        results = {}
        
        # Test health check first
        results['health'] = self.test_health_check()[0]
        
        # Test login API
        results['login'] = self.test_login_api()[0]
        
        # Test other APIs (these depend on login working)
        if results['login']:
            results['messages'] = self.test_messages_api()[0]
            results['send_message'] = self.test_send_message_api()[0]
            results['profile'] = self.test_profile_api()[0]
            results['analytics'] = self.test_analytics_api()[0]
            results['dues'] = self.test_dues_api()[0]
            
            # Test image upload functionality
            upload_success, media_url = self.test_image_upload_api()
            results['image_upload'] = upload_success
            
            # Test image accessibility if upload succeeded
            if upload_success and media_url:
                results['image_accessibility'] = self.test_image_accessibility(media_url)
            else:
                results['image_accessibility'] = False
                
        else:
            self.log("⚠️ Skipping dependent tests due to login failure")
            results.update({
                'messages': False,
                'send_message': False, 
                'profile': False,
                'analytics': False,
                'dues': False,
                'image_upload': False,
                'image_accessibility': False
            })
        
        # Test CORS headers
        results['cors'] = self.test_cors_headers()
        
        # Print summary
        self.log("\n📊 Test Results Summary:")
        self.log(f"   Tests passed: {self.tests_passed}/{self.tests_run}")
        self.log(f"   Success rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        for test_name, passed in results.items():
            status = "✅ PASS" if passed else "❌ FAIL"
            self.log(f"   {test_name}: {status}")
        
        return results

def main():
    tester = MoneyBookAPITester()
    results = tester.run_all_tests()
    
    # Return exit code based on results
    if tester.tests_passed == tester.tests_run:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️ {tester.tests_run - tester.tests_passed} tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())