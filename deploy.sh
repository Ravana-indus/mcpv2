#!/bin/bash

# ERPNext MCP HTTP Server Deployment Script

set -e

echo "🚀 ERPNext MCP HTTP Server Deployment"
echo "====================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# ERPNext Configuration
ERPNEXT_URL=http://your-erpnext-instance.com
ERPNEXT_API_KEY=your-api-key
ERPNEXT_API_SECRET=your-api-secret

# Server Configuration
PORT=3000
EOF
    echo "✅ Created .env file. Please edit it with your ERPNext credentials."
    echo "   Then run this script again."
    exit 0
fi

# Load environment variables
source .env

echo "🔧 Configuration:"
echo "   ERPNext URL: ${ERPNEXT_URL}"
echo "   ERPNext API Key: ${ERPNEXT_API_KEY:0:8}..."
echo "   Port: ${PORT:-3000}"
echo ""

# Build and start the container
echo "🐳 Building and starting Docker container..."
docker-compose up -d --build

echo ""
echo "✅ Deployment completed!"
echo ""
echo "📋 Service Information:"
echo "   Health Check: http://localhost:${PORT:-3000}/health"
echo "   API Endpoint: http://localhost:${PORT:-3000}/mcp"
echo "   Tools Endpoint: http://localhost:${PORT:-3000}/tools"
echo ""
echo "🔍 Check container status:"
echo "   docker-compose ps"
echo ""
echo "📝 View logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 Stop the service:"
echo "   docker-compose down"
echo ""
echo "🧪 Test the server:"
echo "   npm run test"